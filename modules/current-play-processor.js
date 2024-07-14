const globalCache = require('./global-cache');
const globals = require('../config/globals');
const LOGGER = require('./logger')(process.env.LOG_LEVEL?.trim() || globals.LOG_LEVEL.debug);

module.exports = {
    process: (currentPlayJSON) => {
        let reply = '';
        // Check if currentPlayJSON is defined
        if (!currentPlayJSON) {
            console.error('currentPlayJSON is undefined');
            return; // or handle the error as appropriate
        }
    
        if (!globalCache.values.game.startReported
            && currentPlayJSON.playEvents?.find(event => event?.details?.description === 'Status Change - In Progress')) {
            globalCache.values.game.startReported = true;
            if (parseInt(137) === globals.GUARDIANS) {
                reply += (globalCache.values.game.currentLiveFeed.gameData.teams.home.id === globals.GUARDIANS
                    ? 'And we\'re underway at the corner of Carnegie and Ontario.'
                    : 'A game is starting! Go Guards!');
            } else {
                reply += 'A game is starting!';
            }
        }
        let lastEvent;
        if (currentPlayJSON.about?.isComplete
            || globals.EVENT_WHITELIST.includes((currentPlayJSON.result?.eventType || currentPlayJSON.details?.eventType))) {
            reply += getDescription(currentPlayJSON);
            if (currentPlayJSON.result?.isOut || currentPlayJSON.details?.isOut) {
                reply += ' **' + currentPlayJSON.count.outs + (currentPlayJSON.count.outs > 1 ? ' outs. **' : ' out. **');
            }
            if (!currentPlayJSON.reviewDetails?.inProgress
                && (currentPlayJSON.about?.isScoringPlay || currentPlayJSON.details?.isScoringPlay)) {
                reply = addScore(reply, currentPlayJSON);
            }
            if (!currentPlayJSON.about?.hasReview) {
                if (currentPlayJSON.playEvents && currentPlayJSON.playEvents.length > 0) {
                    lastEvent = currentPlayJSON.playEvents[currentPlayJSON.playEvents.length - 1];
                    if (lastEvent?.details?.isInPlay) {
                        reply = addMetrics(lastEvent, reply);
                        LOGGER.debug('reply: ' + reply);
                    }
                    if (lastEvent?.details?.eventType === 'strikeout') {
                        LOGGER.debug('Handling strikeout and zone');
                        reply = handleStrikeoutAndZone(lastEvent, reply);
                    }
                } else if (currentPlayJSON.details?.isInPlay) {
                    reply = addMetrics(currentPlayJSON, reply);
                } else if (currentPlayJSON.details?.eventType === 'strikeout') {
                    reply = handleStrikeoutAndZone(currentPlayJSON, reply);
                }
            }
        }
        return {
            reply,
            isStartEvent: currentPlayJSON.playEvents?.find(event => event?.details?.description === 'Status Change - In Progress'),
            isComplete: currentPlayJSON.about?.isComplete,
            description: (currentPlayJSON.result?.description || currentPlayJSON.details?.description),
            event: (currentPlayJSON.result?.event || currentPlayJSON.details?.event),
            eventType: (currentPlayJSON.result?.eventType || currentPlayJSON.details?.eventType),
            isScoringPlay: (currentPlayJSON.about?.isScoringPlay || currentPlayJSON.details?.isScoringPlay),
            isInPlay: (lastEvent?.details?.isInPlay || currentPlayJSON.details?.isInPlay),
            playId: (lastEvent?.playId || currentPlayJSON.playId),
            hitDistance: (lastEvent?.hitData?.totalDistance || currentPlayJSON.hitData?.totalDistance)
        };
    }
};

function addScore (reply, currentPlayJSON) {
    reply += '\n';
    let homeScore, awayScore;
    if (currentPlayJSON.result) {
        homeScore = currentPlayJSON.result.homeScore;
        awayScore = currentPlayJSON.result.awayScore;
    } else if (currentPlayJSON.details) {
        homeScore = currentPlayJSON.details.homeScore;
        awayScore = currentPlayJSON.details.awayScore;
    }
    reply += (globalCache.values.game.currentLiveFeed.liveData.plays.currentPlay.about.halfInning === 'top'
        ? '# _' + globalCache.values.game.currentLiveFeed.gameData.teams.away.abbreviation + ' ' + awayScore + '_, ' +
        globalCache.values.game.currentLiveFeed.gameData.teams.home.abbreviation + ' ' + homeScore
        : '# ' + globalCache.values.game.currentLiveFeed.gameData.teams.away.abbreviation + ' ' + awayScore + ', _' +
        globalCache.values.game.currentLiveFeed.gameData.teams.home.abbreviation + ' ' + homeScore + '_');

    return reply;
}

function addMetrics(lastEvent, reply) {
    if (lastEvent.hitData.launchSpeed) {
        reply += '\n\n**Statcast Metrics:**\n';
        reply += 'Exit Velo: ' + lastEvent.hitData.launchSpeed + ' mph' +
            getFireEmojis(lastEvent.hitData.launchSpeed) + '\n';
        reply += 'Launch Angle: ' + lastEvent.hitData.launchAngle + '° \n';
        reply += 'Distance: ' + lastEvent.hitData.totalDistance + ' ft.\n';
        reply += 'xBA: Pending...\n';
        reply += lastEvent.hitData.totalDistance && lastEvent.hitData.totalDistance >= 300 ? 'HR/Park: Pending...' : '';
    } else {
        reply += '\n\n**Statcast Metrics:**\n';
        reply += 'Exit Velocity: Unavailable\n';
        reply += 'Launch Angle: Unavailable\n';
        reply += 'Distance: Unavailable\n';
        reply += 'xBA: Unavailable\n';
        reply += 'HR/Park: Unavailable';
    }

    return reply;
}

async function handleStrikeoutAndZone(lastEvent, reply) {
    LOGGER.debug('lastEvent.pitchData:', lastEvent.pitchData);

    // Access gamePk from globalCache
    const gamePk = globalCache.values.gamePk; // Adjust the path according to your globalCache structure

    const { outsideZone, distanceFromZone } = await getStrikeoutDetails(lastEvent, gamePk);

    LOGGER.debug(`Is the pitch outside the zone? ${outsideZone}`);
    LOGGER.debug(lastEvent.count.strikes + " strikes!!!!");

    if (lastEvent.count.strikes === 3) {
        reply += `The pitch was ${outsideZone ? 'outside' : 'inside'} the strike zone.\n`;
        if (outsideZone) {
            reply += `Distance from zone - Horizontal: ${distanceFromZone.horizontal.toFixed(2)}, Vertical: ${distanceFromZone.vertical.toFixed(2)}.\n`;
        }
    }

    const strikeout = lastEvent.event === 'Strikeout';
    LOGGER.debug(`Strikeout status: ${strikeout}`);

    if (outsideZone && strikeout) {
        LOGGER.debug(`Strikeout outside the zone.`);
        LOGGER.debug(`Distance from zone - Horizontal: ${distanceFromZone.horizontal.toFixed(2)}, Vertical: ${distanceFromZone.vertical.toFixed(2)}.`);
    } else {
        LOGGER.debug("Not a strikeout or not outside the zone.");
    }

    return reply;
}
async function getStrikeoutDetails(play, gamePk) {
    let outsideZone = false;
    let distanceFromZone = { horizontal: 0, vertical: 0 };

    const currentLiveFeed = globalCache.values.game.currentLiveFeed;

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

        // Calculate horizontal distance from the zone
        if (px < strikeZone.left) {
            distanceFromZone.horizontal = strikeZone.left - px;
        } else if (px > strikeZone.right) {
            distanceFromZone.horizontal = px - strikeZone.right;
        }

        // Calculate vertical distance from the zone
        if (pz < strikeZone.bottom) {
            distanceFromZone.vertical = strikeZone.bottom - pz;
        } else if (pz > strikeZone.top) {
            distanceFromZone.vertical = pz - strikeZone.top;
        }

        LOGGER.debug(`Is the pitch outside the zone? ${outsideZone}`);
        LOGGER.debug(`Distance from zone - Horizontal: ${distanceFromZone.horizontal}, Vertical: ${distanceFromZone.vertical}`);
    } else {
        LOGGER.warn('pitchData is missing or incomplete for the strikeout event.');
    }

    return { outsideZone, distanceFromZone };
}
function getFireEmojis (launchSpeed) {
    if (launchSpeed >= 95.0 && launchSpeed < 100.0) {
        return ' \uD83D\uDD25';
    } else if (launchSpeed >= 100.0 && launchSpeed < 110.0) {
        return ' \uD83D\uDD25\uD83D\uDD25';
    } else if (launchSpeed >= 110.0) {
        return ' \uD83D\uDD25\uD83D\uDD25\uD83D\uDD25';
    } else {
        return '';
    }
}
function getDescription (currentPlayJSON) {
    if (parseInt(136) === globals.GUARDIANS
        && currentPlayJSON.result?.event === 'Home Run'
        && guardiansBatting(currentPlayJSON)
        && currentPlayJSON.result?.description) {
        return getMarinersHomeRunDescription(currentPlayJSON.result.description);
    }
    return (currentPlayJSON.result?.description || currentPlayJSON.details.description || '');
}

function guardiansBatting (currentPlayJSON) {
    return (currentPlayJSON.about.halfInning === 'bottom' && globalCache.values.game.currentLiveFeed.gameData.teams.home.id === globals.GUARDIANS)
        || (currentPlayJSON.about.halfInning === 'top' && globalCache.values.game.currentLiveFeed.gameData.teams.away.id === globals.GUARDIANS);
}

function getMarinersHomeRunDescription(description) {
    const match = /(?<person>.+)( homers| hits a grand slam)/.exec(description);
    const player = match?.groups.person;
    const isGrandSlam = description.includes("hits a grand slam");
    const partOfField = /to (?<partOfField>[a-zA-Z ]+) field./.exec(description)?.groups.partOfField;
    const scorers = /field.[ ]+(?<scorers>.+)/.exec(description)?.groups.scorers;
    const hrNumber = /.+(?<hrNumber>\([\d]+\))/.exec(description)?.groups.hrNumber;
    return getHomeRunCall(player, partOfField, scorers, hrNumber, isGrandSlam);
}

function getHomeRunCall(player, partOfField, scorers, hrNumber, isGrandSlam) {
    const calls = [
        player.toUpperCase() + ' WITH A SWING AND A DRIVE! TO DEEP ' + partOfField.toUpperCase() + '! A-WAAAAY BACK! GONE!!! ' + hrNumber + '\n' + (scorers || ''),
        player + ' is ready...the pitch...SWUNG ON AND BELTED. FLY AWAY! FLY AWAY! ' + partOfField.toUpperCase() + ' FIELD! THIS BALL: GONE!! ' + hrNumber + '\n' + (scorers || ''),
        'The next pitch to ' + player + '...SWUNG ON! HIT HIGH! HIT DEEP TO ' + partOfField.toUpperCase() + '! IT WILL FLY AWAY! GOODBYE, HOME RUN!! ' + hrNumber + '\n' + (scorers || ''),
        player.toUpperCase() + ' SWINGS AND DRIVES ONE! DEEP ' + partOfField.toUpperCase() + ' FIELD! GOING, GOING, GONE! FLY, FLY AWAY! ' + hrNumber + '\n' + (scorers || ''),
        player + ' steps in...the pitch...SWUNG ON AND CRUSHED! OH MY, GOODBYE BASEBALL! ' + partOfField.toUpperCase() + ' FIELD! SEE YA LATER! ' + hrNumber + '\n' + (scorers || '')
    ];

    if (isGrandSlam) {
        calls.push(
            'AND HERE IT COMES... ' + player.toUpperCase() +
            ' SWINGS AND IT\'S A LONG FLY BALL TO ' +
            partOfField.toUpperCase() +
            ' FIELD... IT\'S OUTTA HERE! GET OUT THE RYE BREAD AND THE MUSTARD, GRANDMA, IT\'S A GRAND SALAMI!!! ' + hrNumber + '\n' +
            (scorers || '')
        );
    }

    return calls[Math.floor(Math.random() * calls.length)];
}