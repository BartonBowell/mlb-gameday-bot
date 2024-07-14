const mlbAPIUtil = require('./MLB-API-util');
const globalCache = require('./global-cache');
const diffPatch = require('./diff-patch');
const currentPlayProcessor = require('./current-play-processor');
const { EmbedBuilder } = require('discord.js');
const globals = require('../config/globals');
const LOGGER = require('./logger')(process.env.LOG_LEVEL?.trim() || globals.LOG_LEVEL.INFO);
const ColorContrastChecker = require('color-contrast-checker');

module.exports = {
    statusPoll, subscribe, getConstrastingEmbedColors, processAndPushPlay, pollForSavantData, processMatchingPlay
};

async function statusPoll (bot) {
    const pollingFunction = async () => {
        LOGGER.info('Games: polling...');
        const now = globals.DATE ? new Date(globals.DATE) : new Date();
        try {
            const currentGames = await mlbAPIUtil.currentGames();
            currentGames.sort((a, b) => Math.abs(now - new Date(a.gameDate)) - Math.abs(now - new Date(b.gameDate)));
            globalCache.values.currentGames = currentGames;
            const nearestGames = currentGames.filter(game => game.officialDate === currentGames[0].officialDate); // could be more than one game for double-headers.
            globalCache.values.nearestGames = nearestGames;
            globalCache.values.game.isDoubleHeader = nearestGames.length > 1;
            const inProgressGame = nearestGames.find(nearestGame => nearestGame.status.statusCode === 'I' || nearestGame.status.statusCode === 'PW');
            if (inProgressGame) {
                LOGGER.info('Gameday: polling stopped: a game is live.');
                globalCache.resetGameCache();
                globalCache.values.game.currentLiveFeed = await mlbAPIUtil.liveFeed(inProgressGame.gamePk);
                module.exports.getConstrastingEmbedColors();
                module.exports.subscribe(bot, inProgressGame, nearestGames);
            } else {
                setTimeout(pollingFunction, globals.SLOW_POLL_INTERVAL);
            }
        } catch (e) {
            LOGGER.error(e);
        }
    };
    await pollingFunction();
}

function subscribe (bot, liveGame, games) {
    LOGGER.trace('Gameday: subscribing...');
    const ws = mlbAPIUtil.websocketSubscribe(liveGame.gamePk);
    ws.addEventListener('message', async (e) => {
        try {
            const eventJSON = JSON.parse(e.data);
            /*
                Once in a while, Gameday will send us duplicate messages. They have different updateIds, but the exact
                same information otherwise, and they arrive at virtually the same instant. This is our way of detecting those
                and disregarding one of them up front. Otherwise the heavily asynchronous code that follows can end up
                reporting both events incidentally.
             */
            if (globalCache.values.game.lastSocketMessageTimestamp === eventJSON.timeStamp
                && globalCache.values.game.lastSocketMessageLength === e.data.length) {
                LOGGER.debug('DUPLICATE MESSAGE: ' + eventJSON.updateId + ' - DISREGARDING');
                return;
            }
            globalCache.values.game.lastSocketMessageTimestamp = eventJSON.timeStamp;
            globalCache.values.game.lastSocketMessageLength = e.data.length;
            if (eventJSON.gameEvents.includes('game_finished') && !globalCache.values.game.finished) {
                globalCache.values.game.finished = true;
                globalCache.values.game.startReported = false;
                LOGGER.info('NOTIFIED OF GAME CONCLUSION: CLOSING...');
                ws.close();
                await statusPoll(bot, games);
            } else if (!globalCache.values.game.finished) {
                LOGGER.trace('RECEIVED: ' + eventJSON.updateId);
                if (eventJSON.changeEvent?.type === 'full_refresh') {
                    LOGGER.trace('FULL REFRESH FOR: ' + eventJSON.updateId);
                }
                const update = eventJSON.changeEvent?.type === 'full_refresh'
                    ? await mlbAPIUtil.wsLiveFeed(eventJSON.gamePk, eventJSON.updateId)
                    : await mlbAPIUtil.websocketQueryUpdateId(
                        eventJSON.gamePk,
                        eventJSON.updateId,
                        globalCache.values.game.currentLiveFeed.metaData.timeStamp
                    );
                if (Array.isArray(update)) {
                    for (const patch of update) {
                        try {
                            diffPatch.hydrate(patch);
                        } catch (e) {
                            // catching something here means our game object could now be incorrect. reset the live feed.
                            globalCache.values.game.currentLiveFeed = await mlbAPIUtil.liveFeed(liveGame.gamePk);
                        }
                        await reportPlays(bot, liveGame.gamePk);
                    }
                } else {
                    globalCache.values.game.currentLiveFeed = update;
                    await reportPlays(bot, liveGame.gamePk);
                }
            }
        } catch (e) {
            LOGGER.error('There was a problem processing a gameday event!');
            LOGGER.error(e);
        }
    });
    ws.addEventListener('error', (e) => console.error(e));
    ws.addEventListener('close', (e) => LOGGER.info('Gameday socket closed: ' + JSON.stringify(e)));
}

function getConstrastingEmbedColors () {
    globalCache.values.game.homeTeamColor = globals.TEAMS.find(
        team => team.id === globalCache.values.game.currentLiveFeed.gameData.teams.home.id
    ).primaryColor;
    const awayTeam = globals.TEAMS.find(
        team => team.id === globalCache.values.game.currentLiveFeed.gameData.teams.away.id
    );
    const colorContrastChecker = new ColorContrastChecker();
    if (colorContrastChecker.isLevelCustom(globalCache.values.game.homeTeamColor, awayTeam.primaryColor, globals.TEAM_COLOR_CONTRAST_RATIO)) {
        globalCache.values.game.awayTeamColor = awayTeam.primaryColor;
    } else {
        globalCache.values.game.awayTeamColor = awayTeam.secondaryColor;
    }
}

async function reportPlays (bot, gamePk) {
    const currentPlay = globalCache.values.game.currentLiveFeed.liveData.plays.currentPlay;
    const atBatIndex = currentPlay.atBatIndex;
    const lastReportedCompleteAtBatIndex = globalCache.values.game.lastReportedCompleteAtBatIndex;
    if (atBatIndex > 0) {
        const lastAtBat = globalCache.values.game.currentLiveFeed.liveData.plays.allPlays
            .find((play) => play.about.atBatIndex === atBatIndex - 1);
        if (lastAtBat && lastAtBat.about.hasReview) { // a play that's been challenged. We should report updates on it.
            await processAndPushPlay(bot, currentPlayProcessor.process(lastAtBat), gamePk, atBatIndex - 1);
        /* TODO: the below block detects and handles if we missed the result of an at-bat due to the data moving too fast. I
        *   haven't witnessed this code being hit during testing or production monitoring, so it can probably be removed.  */
        } else if (lastReportedCompleteAtBatIndex !== null
            && (atBatIndex - lastReportedCompleteAtBatIndex > 1)) {
            LOGGER.debug('Missed at-bat index: ' + atBatIndex - 1);
            await reportAnyMissedEvents(lastAtBat, bot, gamePk, atBatIndex - 1);
            await processAndPushPlay(bot, currentPlayProcessor.process(lastAtBat), gamePk, atBatIndex - 1);
        }
    }
    await reportAnyMissedEvents(currentPlay, bot, gamePk, atBatIndex);
    await processAndPushPlay(bot, currentPlayProcessor.process(currentPlay), gamePk, atBatIndex);
}

async function reportAnyMissedEvents (atBat, bot, gamePk, atBatIndex) {
    const missedEventsToReport = atBat.playEvents?.filter(event => globals.EVENT_WHITELIST.includes(event?.details?.eventType)
        && !globalCache.values.game.reportedDescriptions
            .find(reportedDescription => reportedDescription.description === event?.details?.description && reportedDescription.atBatIndex === atBatIndex));
    for (const missedEvent of missedEventsToReport) {
        await processAndPushPlay(bot, currentPlayProcessor.process(missedEvent), gamePk, atBatIndex);
    }
}
async function processAndPushPlay(bot, play, gamePk, atBatIndex) {
    if (play.reply && play.reply.length > 0 && !globalCache.values.game.reportedDescriptions.find(reportedDescription => reportedDescription.description === play.description && reportedDescription.atBatIndex === atBatIndex)) {
        globalCache.values.game.reportedDescriptions.push({ description: play.description, atBatIndex });
        if (play.isComplete) {
            globalCache.values.game.lastReportedCompleteAtBatIndex = atBatIndex;
        }
        // Retrieve the current score
        const awayScore = globalCache.values.game.currentLiveFeed.liveData.linescore.teams.away.runs;
        const homeScore = globalCache.values.game.currentLiveFeed.liveData.linescore.teams.home.runs;
        const scoreText = `${globalCache.values.game.currentLiveFeed.gameData.teams.away.abbreviation} ${awayScore} - ${homeScore} ${globalCache.values.game.currentLiveFeed.gameData.teams.home.abbreviation}`;
        
        // Modify the title to include the score
        const embed = new EmbedBuilder()
            .setTitle(`${deriveHalfInning(globalCache.values.game.currentLiveFeed.liveData.plays.currentPlay.about.halfInning)} ${globalCache.values.game.currentLiveFeed.liveData.plays.currentPlay.about.inning}, ${scoreText}${play.isScoringPlay ? ' - Scoring Play \u2757' : ''}`)
            .setDescription(play.reply)
            .setColor((globalCache.values.game.currentLiveFeed.liveData.plays.currentPlay.about.halfInning === 'top' ? globalCache.values.game.awayTeamColor : globalCache.values.game.homeTeamColor));
        
        const messages = [];
        for (const channelSubscription of globalCache.values.subscribedChannels) {
            const returnedChannel = await bot.channels.fetch(channelSubscription.channel_id);
            if (!play.isScoringPlay && channelSubscription.scoring_plays_only) {
                LOGGER.debug('Skipping - against the channel\'s preference');
            } else {
                if (channelSubscription.delay === 0 || play.isStartEvent) {
                    await sendMessage(returnedChannel, embed, messages);
                } else {
                    LOGGER.debug('Waiting ' + channelSubscription.delay + ' seconds for channel: ' + channelSubscription.channel_id);
                    await sendDelayedMessage(play, gamePk, channelSubscription, returnedChannel, embed);
                }
            }
        }
        if (messages.length > 0) {
            await maybePopulateAdvancedStatcastMetrics(play, messages, gamePk);
        }
    }
}


function isStrikeout(play) {
    return play.eventType === 'strikeout';
}

async function sendMessage (returnedChannel, embed, messages) {
    LOGGER.debug('Sending!');
    const message = await returnedChannel.send({
        embeds: [embed]
    });
    messages.push(message);
}

async function sendDelayedMessage (play, gamePk, channelSubscription, returnedChannel, embed) {
    setTimeout(async () => {
        LOGGER.debug('Sending delayed!');
        const message = await returnedChannel.send({
            embeds: [embed]
        });
        /* TODO: savant polling will be done for each delayed message individually. Not ideal, but shouldn't be too bad.
            In any case, there's an opportunity for non-delayed messages to cache the info for delayed messages.
         */
        await maybePopulateAdvancedStatcastMetrics(play, [message], gamePk);
    }, channelSubscription.delay * 1000);
}

async function maybePopulateAdvancedStatcastMetrics(play, messages, gamePk) {
    if (play.isInPlay) {
        if (play.playId) {
            try {
                // xBA and HR/Park for balls in play is available on a delay via baseballsavant.
                await pollForSavantData(gamePk, play.playId, messages, play.hitDistance);
            } catch (e) {
                LOGGER.error('There was a problem polling for savant data!');
                LOGGER.error(e);
                notifySavantDataUnavailable(messages);
            }
        } else {
            LOGGER.info('Play has no play ID.');
            notifySavantDataUnavailable(messages);
        }
    } else if (play.eventType === 'strikeout') {
        // Handle strikeout events
        try {
            
            LOGGER.debug('Handling strikeout event.' + JSON.stringify(play));
            const { outsideZone} = await getStrikeoutDetails(play, gamePk);
            if (outsideZone) {
                LOGGER.debug(`Strikeout.`);
                // Append strikeout details to the reply
                const updatedReply = `${play.reply}\nThe pitch was outside the strike zone.`;
                messages.forEach(message => {
                    const receivedEmbed = EmbedBuilder.from(message.embeds[0]);
                    receivedEmbed.setDescription(updatedReply);
                    message.edit({ embeds: [receivedEmbed] });
                });
            }
        } catch (e) {
            LOGGER.error('There was a problem fetching strikeout details!');
            LOGGER.error(e);
        }
    } else {
        LOGGER.debug('Skipping savant poll for ' + JSON.stringify(play) + '- not in play.');
    }
}
async function getStrikeoutDetails(play, gamePk) {
    let outsideZone = false;
    
    
    const currentLiveFeed = globalCache.values.game.currentLiveFeed;
    LOGGER.debug(JSON.stringify(currentLiveFeed) + "ASDASD ASDAS DASD");
    if (currentLiveFeed && currentLiveFeed.liveData.plays.currentPlay.playEvents) {
        const strikeZone = {
            top: currentLiveFeed.liveData.plays.currentPlay.playEvents[0].pitchData.strikeZoneTop ?? 0,
            bottom: currentLiveFeed.liveData.plays.currentPlay.playEvents[0].pitchData.strikeZoneBottom ?? 0,
            left: -0.7083 - 0.121,
            right: 0.7083 + 0.121
        };
        const px = currentLiveFeed.liveData.plays.currentPlay.playEvents[0].pitchData.coordinates?.pX ?? 0;
        const pz = currentLiveFeed.liveData.plays.currentPlay.playEvents[0].pitchData.coordinates?.pZ ?? 0;
        outsideZone =
            pz < strikeZone.bottom ||
            pz > strikeZone.top ||
            px < strikeZone.left ||
            px > strikeZone.right;
            LOGGER.debug(`Is the pitch outside the zone? ${outsideZone}`);
    } else {
        LOGGER.warn('pitchData is missing or incomplete for the strikeout event.');
    }

    return { outsideZone };
}
function notifySavantDataUnavailable (messages) {
    for (let i = 0; i < messages.length; i ++) {
        const receivedEmbed = EmbedBuilder.from(messages[i].embeds[0]);
        let description = messages[i].embeds[0].description;
        if (description.includes('Pending...')) {
            description = description.replaceAll('Pending...', 'Not Available.');
            receivedEmbed.setDescription(description);
            messages[i].edit({ embeds: [receivedEmbed] });
        }
    }
}

async function pollForSavantData (gamePk, playId, messages, hitDistance) {
    let attempts = 1;
    const messageTrackers = messages.map(message => { return { id: message.id, done: false }; });
    const pollingFunction = async () => {
        if (messageTrackers.every(messageTracker => messageTracker.done)) {
            LOGGER.debug('Savant: all messages done.');
            return;
        }
        if (attempts < 10) {
            LOGGER.trace('Savant: polling for ' + playId + '...');
            const gameFeed = await mlbAPIUtil.savantGameFeed(gamePk);
            const matchingPlay = gameFeed?.team_away?.find(play => play?.play_id === playId)
                || gameFeed?.team_home?.find(play => play?.play_id === playId);
            if (matchingPlay && (matchingPlay.xba || matchingPlay.contextMetrics?.homeRunBallparks !== undefined)) {
                module.exports.processMatchingPlay(gamePk,matchingPlay, messages, messageTrackers, playId, hitDistance);
            }
            attempts ++;
            setTimeout(async () => { await pollingFunction(); }, globals.SAVANT_POLLING_INTERVAL);
        } else {
            LOGGER.debug('max savant polling attempts reached for: ' + playId);
            notifySavantDataUnavailable(messages);
        }
    };
    await pollingFunction();
}async function getBallparkOutlier(gamePk, playId, homeRunBallparks, homeParkId, outliers = [1, 2, 3, 27, 28, 29]) {
    try {
        const ballpark = await mlbAPIUtil.xParks(gamePk, playId);
        let outlierText = '';

        if (homeRunBallparks === 0) {
            outlierText = ' (gone nowhere!)';
        } else if (homeRunBallparks === 30) {
            outlierText = ' (gone everywhere!)';
        } else if (outliers.includes(homeRunBallparks)) {
            if (ballpark.hr && ballpark.hr.length > 0) {
                const parks = ballpark.hr.map(park => park.name).join(', ');
                outlierText = ` (only a HR at ${parks})`;

                if (ballpark.hr.some(park => park.id === homeParkId)) {
                    outlierText += ' 🏠';
                } else if (ballpark.hr.length === 1) {
                    outlierText += ' 🦄';
                }
            } else if (ballpark.not && ballpark.not.length > 0) {
                const parks = ballpark.not.map(park => park.name).join(', ');
                outlierText = ` (a HR at every park except ${parks})`;

                if (ballpark.not.some(park => park.id === homeParkId)) {
                    outlierText += ' 🏠';
                } else if (ballpark.not.length === 1) {
                    outlierText += ' 🦄';
                }
            }
        }

        LOGGER.debug(`Editing with HR/Park: ${playId}`);
        LOGGER.trace(`Edited: message-id-1`);
        LOGGER.debug(`Ballpark outlier detected: ${outlierText}`);

        return outlierText;
    } catch (error) {
        LOGGER.error(`Error fetching ballpark data for gamePk ${gamePk} and playId ${playId}: ${error.message}`);
        return '';
    }
}
function processMatchingPlay(gamePk, matchingPlay, messages, messageTrackers, playId, hitDistance) {
    for (let i = 0; i < messages.length; i++) {
        const receivedEmbed = EmbedBuilder.from(messages[i].embeds[0]);
        let description = messages[i].embeds[0].description;

        if (matchingPlay.xba && description.includes('xBA: Pending...')) {
            LOGGER.debug('Editing with xba: ' + playId);
            description = description.replaceAll('xBA: Pending...', 'xBA: ' + matchingPlay.xba +
                (parseFloat(matchingPlay.xba) > 0.5 ? ' \uD83D\uDFE2' : ''));
            receivedEmbed.setDescription(description);
            messages[i].edit({
                embeds: [receivedEmbed]
            }).then((m) => LOGGER.trace('Edited: ' + m.id)).catch((e) => console.error(e));
        }

        if (hitDistance && hitDistance >= 300 &&
            matchingPlay.contextMetrics?.homeRunBallparks !== undefined &&
            description.includes('HR/Park: Pending...')) {
            LOGGER.debug('Editing with HR/Park: ' + playId);
            let hrParkText = 'HR/Park: ' + matchingPlay.contextMetrics.homeRunBallparks + '/30';
            
            if (hitDistance && hitDistance >= 300 &&
                matchingPlay.contextMetrics?.homeRunBallparks !== undefined &&
                description.includes('HR/Park: Pending...')) {
                LOGGER.debug('Editing with HR/Park: ' + playId);
                let hrParkText = 'HR/Park: ' + matchingPlay.contextMetrics.homeRunBallparks + '/30';
                // Assuming globalCache and globals are already defined and contain the necessary structures
                const homeParkId = globalCache.values.game.currentLiveFeed.gameData.venue.id;
                console.log('Home park ID: ' + homeParkId)

            // Now homeParkId contains the ID of the home team, which is used as the homeParkId
                // Check if homeRunBallparks is an outlier (0, 1, 29, or 30)
                if ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].includes(matchingPlay.contextMetrics.homeRunBallparks)) {
                    getBallparkOutlier(gamePk, playId, matchingPlay.contextMetrics.homeRunBallparks, homeParkId, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
                        .then(outlier => {
                            hrParkText += outlier; // Append the outlier symbol or text
                            description = description.replaceAll('HR/Park: Pending...', hrParkText);
                            receivedEmbed.setDescription(description);
                            messages[i].edit({
                                embeds: [receivedEmbed]
                            }).then((m) => LOGGER.trace('Edited: ' + m.id)).catch((e) => console.error(e));
                        });
                } else {
                    // For non-outlier values, just replace the placeholder with the hrParkText
                    description = description.replaceAll('HR/Park: Pending...', hrParkText);
                    receivedEmbed.setDescription(description);
                    messages[i].edit({
                        embeds: [receivedEmbed]
                    }).then((m) => LOGGER.trace('Edited: ' + m.id)).catch((e) => console.error(e));
                }
            } else {
                description = description.replaceAll('HR/Park: Pending...', hrParkText);
                receivedEmbed.setDescription(description);
                messages[i].edit({
                    embeds: [receivedEmbed]
                }).then((m) => LOGGER.trace('Edited: ' + m.id)).catch((e) => console.error(e));
            }
        }

        if (matchingPlay.xba && matchingPlay.contextMetrics?.homeRunBallparks !== undefined) {
            LOGGER.debug('Found all metrics: done polling for: ' + playId);
            messageTrackers.find(tracker => tracker.id === messages[i].id).done = true;
        }
    }
}

function deriveHalfInning (halfInningFull) {
    return halfInningFull === 'top' ? 'TOP' : 'BOT';
}
