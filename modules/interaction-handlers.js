const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const globalCache = require('./global-cache');
const mlbAPIUtil = require('./MLB-API-util');
const globals = require('../config/globals');
const commandUtil = require('./command-util');
const queries = require('../database/queries.js');

module.exports = {leadersHandler,streaksHandler,
    playerStatsHandler,
    helpHandler: async (interaction) => {
        console.info(`HELP command invoked by guild: ${interaction.guildId}`);
        interaction.reply({ content: globals.HELP_MESSAGE, ephemeral: true });
    },bullpenHandler: async (interaction) => {
        console.info(`BULLPEN command invoked by guild: ${interaction.guildId}`);
        await interaction.deferReply();
      
        try {
          const jsonString = await mlbAPIUtil.marinersBullpenUsage();
          console.log(jsonString); // Temporarily log the JSON string to inspect its structure
      
          const json = JSON.parse(jsonString);
      
          if (!json || !json.SEA) {
            throw new Error('Invalid JSON data received');
          }
      
          // Extract the relevant data from the JSON
          const data = json.SEA.map(player => ({
            player: player.player,
            fri: player.day5,
            sat: player.day4,
            sun: player.day3,
            mon: player.day2,
            tues: player.day1,
            last3: player.last3,
            last5: player.last5
          }));
      
          // Debug: Log the extracted data before passing it to generate the table
          console.debug("Extracted data for bullpen usage:", JSON.stringify(data, null, 2));
      
          // Generate the HTML table
          const tableHTML = commandUtil.generateBullpenUsageTable(data);
      
          // Get the screenshot of the table
          const screenshot = await commandUtil.getBullpenUsageScreenshot(tableHTML);
      
          await interaction.followUp({
            content: 'Here\'s the current bullpen usage for the Seattle Mariners:',
            files: [{ attachment: screenshot, name: 'bullpen_usage.png' }],
            ephemeral: false
          });
        } catch (error) {
          console.error('Error in bullpen command:', error);
          await interaction.followUp({
            content: 'There was an error fetching the bullpen usage. Please try again later. If the issue persists, please contact the developer.',
            ephemeral: true
          });
        }
      },
            
      
      startersHandler: async (interaction) => {
        console.info(`STARTERS command invoked by guild: ${interaction.guildId}`);
        await interaction.deferReply();
        // as opposed to other commands, this one will look for the nearest game that is not finished (AKA in "Live" or "Preview" status).
        const game = globalCache.values.currentGames.find(game => game.status.abstractGameState !== 'Final');
        if (!game) {
            await interaction.followUp({
                content: 'No game found that isn\'t Final. Is today/tomorrow an off day?',
                ephemeral: false
            });
            return;
        }
        const matchup = await mlbAPIUtil.matchup(game.gamePk);
        const probables = matchup.probables;
        const hydratedHomeProbable = await commandUtil.hydrateProbable(probables.homeProbable);
        const hydratedAwayProbable = await commandUtil.hydrateProbable(probables.awayProbable);

        try {
            const matchupImage = await commandUtil.buildPitchingMatchupImage(game, hydratedHomeProbable, hydratedAwayProbable, probables);

            await interaction.followUp({
                ephemeral: false,
                files: [new AttachmentBuilder(matchupImage, { name: 'matchup.png' })],
                components: [],
                content: ''
            });
        } catch (error) {
            console.error('Error generating pitching matchup image:', error);
            await interaction.followUp({
                content: 'There was an error generating the pitching matchup image. Please try again later.',
                ephemeral: true
            });
        }
    },

 

    scheduleHandler: async (interaction) => {
        console.info(`SCHEDULE command invoked by guild: ${interaction.guildId}`);
        const oneWeek = new Date();
        oneWeek.setDate(oneWeek.getDate() + 7);
        const nextWeek = await mlbAPIUtil.schedule(
            new Date().toISOString().split('T')[0],
            (oneWeek).toISOString().split('T')[0]
        );
        let reply = '';
        nextWeek.dates.forEach((date) => {
            const game = date.games[0];
            const gameDate = new Date(game.gameDate);
            const teams = game.teams;
            const home = teams.home.team.id === parseInt(process.env.TEAM_ID);
            reply += date.date.substr(6) +
                (home ? ' vs. ' : ' @ ') + (home ? teams.away.team.name : teams.home.team.name) + ' ' +
                gameDate.toLocaleString('en-US', {
                    timeZone: 'America/New_York',
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZoneName: 'short'
                }) +
                '\n';
        });
        await interaction.reply({
            ephemeral: false,
            content: reply
        });
    },

    standingsHandler: async (interaction) => {
        interaction.deferReply();
        console.info(`STANDINGS command invoked by guild: ${interaction.guildId}`);
        const team = await mlbAPIUtil.team(process.env.TEAM_ID);
        const divisionId = team.teams[0].division.id;
        const leagueId = team.teams[0].league.id;
        const divisionStandings = (await mlbAPIUtil.standings(leagueId))
            .records.find((record) => record.division.id === divisionId);
        await interaction.followUp({
            ephemeral: false,
            files: [new AttachmentBuilder((await commandUtil.buildStandingsTable(divisionStandings, team.teams[0].division.name)), { name: 'standings.png' })]
        });
    },

    subscribeGamedayHandler: async (interaction) => {
        console.info(`SUBSCRIBE GAMEDAY command invoked by guild: ${interaction.guildId}`);
        if (!interaction.member.roles.cache.some(role => globals.ADMIN_ROLES.includes(role.name))) {
            await interaction.reply({
                ephemeral: true,
                content: 'You do not have permission to subscribe channels to the Gameday feed.'
            });
            return;
        }
        const scoringPlaysOnly = interaction.options.getBoolean('scoring_plays_only');
        const reportingDelay = interaction.options.getInteger('reporting_delay');
        if (interaction.channel) {
            await queries.addToSubscribedChannels(
                interaction.guild.id,
                interaction.channel.id,
                scoringPlaysOnly || false,
                reportingDelay || 0
            ).catch(async (e) => {
                if (e.message.includes('duplicate key')) {
                    await interaction.reply({
                        content: 'This channel is already subscribed to the gameday feed.',
                        ephemeral: false
                    });
                } else {
                    await interaction.reply({
                        content: 'Error subscribing to the gameday feed: ' + e.message,
                        ephemeral: true
                    });
                }
            });
            globalCache.values.subscribedChannels = await queries.getAllSubscribedChannels();
        } else {
            throw new Error('Could not subscribe to the gameday feed.');
        }

        if (!interaction.replied) {
            await interaction.reply({
                ephemeral: false,
                content: 'Subscribed this channel to the gameday feed.\n' +
                    'Events: ' + (scoringPlaysOnly ? '**Scoring Plays Only**' : '**All Plays**') + '\n' +
                    'Reporting Delay: **' + (reportingDelay || 0) + ' seconds**'
            });
        }
    },

    gamedayPreferenceHandler: async (interaction) => {
        console.info(`GAMEDAY PREFERENCE command invoked by guild: ${interaction.guildId}`);
        if (!interaction.member.roles.cache.some(role => globals.ADMIN_ROLES.includes(role.name))) {
            await interaction.reply({
                ephemeral: true,
                content: 'You do not have permission to use this command.'
            });
            return;
        }
        const scoringPlaysOnly = interaction.options.getBoolean('scoring_plays_only');
        const reportingDelay = interaction.options.getInteger('reporting_delay');
        if (interaction.channel) {
            await queries.updatePlayPreference(
                interaction.guild.id,
                interaction.channel.id,
                scoringPlaysOnly,
                reportingDelay
            )
                .then(async (rows) => {
                    if (rows.length === 0) {
                        await interaction.reply({
                            content: 'This channel isn\'t currently subscribed. Use `/subscribe_gameday` to subscribe and provide a preference.',
                            ephemeral: false
                        });
                    }
                })
                .catch(async (e) => {
                    await interaction.reply({
                        content: 'Error subscribing to the gameday feed: ' + e.message,
                        ephemeral: true
                    });
                });
            globalCache.values.subscribedChannels = await queries.getAllSubscribedChannels();
        } else {
            throw new Error('Could not update your subscription preference.');
        }

        if (!interaction.replied) {
            await interaction.reply({
                ephemeral: false,
                content: 'Updated this channel\'s Gameday play reporting preferences:\n' +
                    'Events: ' + (scoringPlaysOnly ? '**Scoring Plays Only**' : '**All Plays**') + '\n' +
                    'Reporting Delay: **' + (reportingDelay || 0) + ' seconds**'
            });
        }
    },

    unSubscribeGamedayHandler: async (interaction) => {
        console.info(`UNSUBSCRIBE GAMEDAY command invoked by guild: ${interaction.guildId}`);
        if (!interaction.member.roles.cache.some(role => globals.ADMIN_ROLES.includes(role.name))) {
            await interaction.reply({
                ephemeral: true,
                content: 'You do not have permission to un-subscribe channels to the Gameday feed.'
            });
            return;
        }
        await queries.removeFromSubscribedChannels(interaction.guild.id, interaction.channel.id).catch(async (e) => {
            await interaction.reply({ content: 'Error un-subscribing: ' + e.message, ephemeral: true });
        });

        if (!interaction.replied) {
            await interaction.reply({
                ephemeral: false,
                content: 'This channel is un-subscribed to the Gameday feed. It will no longer receive real-time updates.'
            });
        }
        globalCache.values.subscribedChannels = await queries.getAllSubscribedChannels();
    },

    linescoreHandler: async (interaction) => {
        console.info(`LINESCORE command invoked by guild: ${interaction.guildId}`);
        if (!globalCache.values.game.isDoubleHeader) {
            await interaction.deferReply();
        }
        const toHandle = await commandUtil.screenInteraction(interaction);
        if (toHandle) {
            const game = globalCache.values.game.isDoubleHeader
                ? globalCache.values.nearestGames.find(game => game.gamePk === parseInt(toHandle.customId)) // the user's choice between the two games of the double-header.
                : globalCache.values.nearestGames[0];
            const statusCheck = await mlbAPIUtil.statusCheck(game.gamePk);
            if (statusCheck.gameData.status.abstractGameState === 'Preview') {
                await commandUtil.giveFinalCommandResponse(toHandle, {
                    ephemeral: false,
                    content: commandUtil.constructGameDisplayString(game) + ' - the game has not yet started.',
                    components: []
                });
                return;
            }
            const linescore = await mlbAPIUtil.linescore(game.gamePk);
            const linescoreAttachment = new AttachmentBuilder(
                await commandUtil.buildLineScoreTable(game, linescore)
                , { name: 'line_score.png' });
            await commandUtil.giveFinalCommandResponse(toHandle, {
                ephemeral: false,
                content: commandUtil.constructGameDisplayString(game) +
                    ' - **' + (statusCheck.gameData.status.abstractGameState === 'Final'
                    ? 'Final'
                    : linescore.inningState + ' ' + linescore.currentInningOrdinal) + '**\n\n',
                components: [],
                files: [linescoreAttachment]
            });
        }
    },

    boxScoreHandler: async (interaction) => {
        console.info(`BOXSCORE command invoked by guild: ${interaction.guildId}`);
        if (!globalCache.values.game.isDoubleHeader) {
            await interaction.deferReply();
        }
        const toHandle = await commandUtil.screenInteraction(interaction);
        if (toHandle) {
            const game = globalCache.values.game.isDoubleHeader
                ? globalCache.values.nearestGames.find(game => game.gamePk === parseInt(toHandle.customId)) // the user's choice between the two games of the double-header.
                : globalCache.values.nearestGames[0];
            const statusCheck = await mlbAPIUtil.statusCheck(game.gamePk);
            if (statusCheck.gameData.status.abstractGameState === 'Preview') {
                await commandUtil.giveFinalCommandResponse(toHandle, {
                    ephemeral: false,
                    content: commandUtil.constructGameDisplayString(game) + ' - the game has not yet started.',
                    components: []
                });
                return;
            }
            const [boxScore, boxScoreNames] = await Promise.all([
                mlbAPIUtil.boxScore(game.gamePk),
                mlbAPIUtil.liveFeedBoxScoreNamesOnly(game.gamePk)
            ]);
            const boxscoreAttachment = new AttachmentBuilder(
                await commandUtil.buildBoxScoreTable(game, boxScore, boxScoreNames, statusCheck.gameData.status.abstractGameState)
                , { name: 'boxscore.png' });
            const awayAbbreviation = game.teams.away.team?.abbreviation || game.teams.away.abbreviation;
            const homeAbbreviation = game.teams.home.team?.abbreviation || game.teams.home.abbreviation;
            await commandUtil.giveFinalCommandResponse(toHandle, {
                ephemeral: false,
                content: homeAbbreviation + ' vs. ' + awayAbbreviation +
                    ', ' + new Date(game.gameDate).toLocaleString('default', {
                    month: 'short',
                    day: 'numeric',
                    timeZone: 'America/New_York',
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZoneName: 'short'
                }),
                components: [],
                files: [boxscoreAttachment]
            });
        }
    },
    lineupSplitsHandler: async (interaction) => {
        console.info(`LINEUP SPLITS command invoked by guild: ${interaction.guildId}`);
    
        if (!globalCache.values.game.isDoubleHeader) {
            await interaction.deferReply();
        }
        const toHandle = await commandUtil.screenInteraction(interaction);
    
        if (toHandle) {
            try {
                const game = globalCache.values.game.isDoubleHeader
                    ? globalCache.values.nearestGames.find(game => game.gamePk === parseInt(toHandle.customId))
                    : globalCache.values.nearestGames[0];
    
                if (!game) {
                    throw new Error('No game found');
                }
    
                const lineupData = await mlbAPIUtil.lineup(game.gamePk, parseInt(process.env.TEAM_ID));
    
                if (lineupData?.dates[0]?.games[0]?.status?.detailedState === 'Postponed') {
                    await commandUtil.giveFinalCommandResponse(toHandle, {
                        content: commandUtil.constructGameDisplayString(game) + ' - this game is postponed.',
                        ephemeral: false,
                        components: []
                    });
                    return;
                }
    
                const ourTeam = lineupData.dates[0].games[0].teams.home.team.id === parseInt(process.env.TEAM_ID)
                    ? lineupData.dates[0].games[0].lineups.homePlayers
                    : lineupData.dates[0].games[0].lineups.awayPlayers;
    
                if (!ourTeam || ourTeam.length === 0) {
                    await commandUtil.giveFinalCommandResponse(toHandle, {
                        content: commandUtil.constructGameDisplayString(game) + ' - lineup is not available yet.',
                        ephemeral: false,
                        components: []
                    });
                    return;
                }
    
                const personIds = ourTeam.map(player => player.id).join(',');
                const playerSplitsData = await mlbAPIUtil.playerSplits(personIds);
                const playerSeasonData = await mlbAPIUtil.peopleStr(personIds);
        if (!game) {
            await interaction.followUp({
                content: 'No game found that isn\'t Final. Is today/tomorrow an off day?',
                ephemeral: false
            });
            return;
        }
        const matchup = await mlbAPIUtil.matchup(game.gamePk);
        const probables = matchup.probables;
        const opposingPitcher = matchup.homeId !== parseInt(process.env.TEAM_ID) ? probables.homeProbable : probables.awayProbable;
        const pitcherName = matchup.homeId !== parseInt(process.env.TEAM_ID) ? probables.homeProbableLastName : probables.awayProbableLastName;
        
        console.log('Player Splits Data:', playerSplitsData);
        
        const lineupSplitsTable = await commandUtil.getLineupSplitsTable(ourTeam, playerSplitsData.people, playerSeasonData.people, opposingPitcher, pitcherName);
                await commandUtil.giveFinalCommandResponse(toHandle, {
                    ephemeral: false,
                    content: commandUtil.constructGameDisplayString(game) + '\n',
                    components: [],
                    files: [new AttachmentBuilder(lineupSplitsTable, { name: 'lineup_splits.png' })]
                });
            } catch (error) {
                console.error('Error in lineupSplitsHandler:', error);
                await commandUtil.giveFinalCommandResponse(toHandle, {
                    content: 'An error occurred while fetching lineup splits. Please try again later.',
                    ephemeral: true,
                    components: []
                });
            }
        }
    },

    lineupHandler: async (interaction) => {
        console.info(`LINEUP command invoked by guild: ${interaction.guildId}`);
        if (!globalCache.values.game.isDoubleHeader) {
            await interaction.deferReply();
        }
        const toHandle = await commandUtil.screenInteraction(interaction);
        if (toHandle) {
            const game = globalCache.values.game.isDoubleHeader
                ? globalCache.values.nearestGames.find(game => game.gamePk === parseInt(toHandle.customId)) // the user's choice between the two games of the double-header.
                : globalCache.values.nearestGames[0];
            const updatedLineup = (await mlbAPIUtil.lineup(game.gamePk))?.dates[0].games[0];
            const ourTeamLineup = updatedLineup.teams.home.team.id === parseInt(process.env.TEAM_ID)
                ? updatedLineup.lineups?.homePlayers
                : updatedLineup.lineups?.awayPlayers;
            if (updatedLineup.status.detailedState === 'Postponed') {
                await commandUtil.giveFinalCommandResponse(toHandle, {
                    content: commandUtil.constructGameDisplayString(game) + ' - this game is postponed.',
                    ephemeral: false,
                    components: []
                });
                return;
            } else if (!ourTeamLineup) {
                await commandUtil.giveFinalCommandResponse(toHandle, {
                    content: commandUtil.constructGameDisplayString(game) + ' - No lineup card has been submitted for this game yet.',
                    ephemeral: false,
                    components: []
                });
                return;
            }
            await commandUtil.giveFinalCommandResponse(toHandle, {
                ephemeral: false,
                content: commandUtil.constructGameDisplayString(game) + '\n',
                components: [],
                files: [new AttachmentBuilder(await commandUtil.getLineupCardTable(updatedLineup), { name: 'lineup.png' })]
            });
        }
    },


    highlightsHandler: async (interaction) => {
        console.info(`HIGHLIGHTS command invoked by guild: ${interaction.guildId}`);
        if (!globalCache.values.game.isDoubleHeader) {
            await interaction.deferReply();
        }
        const toHandle = await commandUtil.screenInteraction(interaction);
        if (toHandle) {
            const game = globalCache.values.game.isDoubleHeader
                ? globalCache.values.nearestGames.find(game => game.gamePk === parseInt(toHandle.customId)) // the user's choice between the two games of the double-header.
                : globalCache.values.nearestGames[0];
            const statusCheck = await mlbAPIUtil.statusCheck(game.gamePk);
            if (statusCheck.gameData.status.abstractGameState === 'Preview') {
                await commandUtil.giveFinalCommandResponse(toHandle, {
                    content: commandUtil.constructGameDisplayString(game) + ' - There are no highlights for this game yet, but here\'s a preview:\n' +
                        'https://www.mlb.com/stories/game-preview/' + game.gamePk,
                    ephemeral: false,
                    components: []
                });
                return;
            }
            await commandUtil.giveFinalCommandResponse(toHandle, {
                content: '### Highlights: ' + commandUtil.constructGameDisplayString(game) + '\n' + 'https://www.mlb.com/stories/game/' + game.gamePk,
                ephemeral: false,
                components: []
            });
        }
    },

    pitcherHandler: async (interaction) => {
        console.info(`PITCHER command invoked by guild: ${interaction.guildId}`);
        await interaction.deferReply();
        const currentLiveFeed = globalCache.values.game.currentLiveFeed;
        if (currentLiveFeed === null || currentLiveFeed.gameData.status.abstractGameState !== 'Live') {
            await interaction.followUp('No game is live right now!');
            return;
        }
        const pitcher = currentLiveFeed.liveData.plays.currentPlay.matchup.pitcher;
        const pitcherInfo = await commandUtil.hydrateProbable(pitcher.id);
        const attachment = new AttachmentBuilder(Buffer.from(pitcherInfo.spot), { name: 'spot.png' });
        const abbreviations = commandUtil.getAbbreviations(currentLiveFeed);
        const halfInning = currentLiveFeed.liveData.plays.currentPlay.about.halfInning;
        const inning = currentLiveFeed.liveData.plays.currentPlay.about.inning;
        const abbreviation = halfInning === 'top'
            ? abbreviations.home
            : abbreviations.away;
        const myEmbed = new EmbedBuilder()
            .setTitle(halfInning.toUpperCase() + ' ' + inning + ', ' +
                abbreviations.away + ' vs. ' + abbreviations.home + ': Current Pitcher')
            .setThumbnail('attachment://spot.png')
            .setDescription(
                '## ' + (pitcherInfo.handedness
                    ? pitcherInfo.handedness + 'HP **'
                    : '**') + (pitcher.fullName || 'TBD') + '** (' + abbreviation + ')' +
                buildPitchingStatsMarkdown(pitcherInfo.pitchingStats, pitcherInfo.pitchMix, true))
            .setColor((halfInning === 'top'
                ? globalCache.values.game.homeTeamColor
                : globalCache.values.game.awayTeamColor)
            );
        await interaction.followUp({
            ephemeral: false,
            files: [attachment],
            embeds: [myEmbed],
            components: [],
            content: ''
        });
    },

    batterHandler: async (interaction) => {
        console.info(`BATTER command invoked by guild: ${interaction.guildId}`);
        await interaction.deferReply();
        const currentLiveFeed = globalCache.values.game.currentLiveFeed;
        if (currentLiveFeed === null || currentLiveFeed.gameData.status.abstractGameState !== 'Live') {
            await interaction.followUp('No game is live right now!');
            return;
        }
        const batter = currentLiveFeed.liveData.plays.currentPlay.matchup.batter;
        const batterInfo = await commandUtil.hydrateHitter(batter.id);
        const attachment = new AttachmentBuilder(Buffer.from(batterInfo.spot), { name: 'spot.png' });
        const abbreviations = commandUtil.getAbbreviations(currentLiveFeed);
        const halfInning = currentLiveFeed.liveData.plays.currentPlay.about.halfInning;
        const inning = currentLiveFeed.liveData.plays.currentPlay.about.inning;
        const abbreviation = halfInning === 'top'
            ? abbreviations.away
            : abbreviations.home;
        const myEmbed = new EmbedBuilder()
            .setTitle(halfInning.toUpperCase() + ' ' + inning + ', ' +
                abbreviations.away + ' vs. ' + abbreviations.home + ': Current Batter')
            .setThumbnail('attachment://spot.png')
            .setDescription(
                '## ' + currentLiveFeed.liveData.plays.currentPlay.matchup.batSide.code +
                'HB ' + batter.fullName + ' (' + abbreviation + ')' +
                commandUtil.formatSplits(
                    batterInfo.stats.stats.find(stat => stat.type.displayName === 'season'),
                    batterInfo.stats.stats.find(stat => stat.type.displayName === 'statSplits'),
                    batterInfo.stats.stats.find(stat => stat.type.displayName === 'lastXGames'))
            )
            .setColor((halfInning === 'top'
                ? globalCache.values.game.awayTeamColor
                : globalCache.values.game.homeTeamColor)
            );
        await interaction.followUp({
            ephemeral: false,
            files: [attachment],
            embeds: [myEmbed],
            components: [],
            content: ''
        });
    },

    scoringPlaysHandler: async (interaction) => {
        console.info(`SCORING PLAYS command invoked by guild: ${interaction.guildId}`);
        if (!globalCache.values.game.isDoubleHeader) {
            await interaction.deferReply();
        }
        const toHandle = await commandUtil.screenInteraction(interaction);
        if (toHandle) {
            const game = globalCache.values.game.isDoubleHeader
                ? globalCache.values.nearestGames.find(game => game.gamePk === parseInt(toHandle.customId)) // the user's choice between the two games of the double-header.
                : globalCache.values.nearestGames[0];
            const liveFeed = await mlbAPIUtil.liveFeed(game.gamePk);
            const links = [];
            liveFeed.liveData.plays.scoringPlays.forEach((scoringPlayIndex) => {
                const play = liveFeed.liveData.plays.allPlays
                    .find(play => play.about.atBatIndex === scoringPlayIndex);
                const link = 'https://www.mlb.com/gameday/' +
                    liveFeed.gameData.teams.away.teamName.toLowerCase().replaceAll(' ', '-') +
                    '-vs-' +
                    liveFeed.gameData.teams.home.teamName.toLowerCase().replaceAll(' ', '-') + '/' +
                    liveFeed.gameData.datetime.officialDate.replaceAll('-', '/') +
                    '/' + game.gamePk + '/play/' + scoringPlayIndex;
                links.push(getScoreString(liveFeed, play) + ' [' + play.result.description.trim() + '](<' + link + '>)\n');
            });
            // discord limits messages to 2,000 characters. We very well might need a couple messages to link everything.
            const messagesNeeded = Math.ceil(liveFeed.liveData.plays.scoringPlays.length / globals.SCORING_PLAYS_PER_MESSAGE);
            if (messagesNeeded > 1) {
                for (let i = 0; i < messagesNeeded; i ++) {
                    const linksForMessage = links.slice(
                        globals.HIGHLIGHTS_PER_MESSAGE * i,
                        Math.min((globals.HIGHLIGHTS_PER_MESSAGE * (i + 1)), links.length)
                    );
                    if (i === 0) {
                        await commandUtil.giveFinalCommandResponse(toHandle, {
                            content: '### Scoring Plays: ' + commandUtil.constructGameDisplayString(game) + '\n' + linksForMessage.join(''),
                            ephemeral: false,
                            components: []
                        });
                    } else {
                        await interaction.channel.send('Continued...\n\n' + linksForMessage.join(''));
                    }
                }
            } else if (messagesNeeded === 0) {
                await commandUtil.giveFinalCommandResponse(toHandle, {
                    content: commandUtil.constructGameDisplayString(game) + '\nThere are no scoring plays for this game yet.',
                    ephemeral: false,
                    components: []
                });
            } else {
                await commandUtil.giveFinalCommandResponse(toHandle, {
                    content: '### Scoring Plays: ' + commandUtil.constructGameDisplayString(game) + '\n' + links.join(''),
                    ephemeral: false,
                    components: []
                });
            }
        }
    },

    attendanceHandler: async (interaction) => {
        console.info(`ATTENDANCE command invoked by guild: ${interaction.guildId}`);
        if (!globalCache.values.game.isDoubleHeader) {
            await interaction.deferReply();
        }
        const toHandle = await commandUtil.screenInteraction(interaction);
        if (toHandle) {
            const game = globalCache.values.game.isDoubleHeader
                ? globalCache.values.nearestGames.find(game => game.gamePk === parseInt(toHandle.customId)) // the user's choice between the two games of the double-header.
                : globalCache.values.nearestGames[0];
            const currentLiveFeed = await mlbAPIUtil.liveFeed(game.gamePk, [
                'gameData', 'gameInfo', 'attendance', 'venue', 'name', 'fieldInfo', 'capacity'
            ]);
            const attendance = currentLiveFeed.gameData.gameInfo.attendance;
            const capacity = currentLiveFeed.gameData.venue.fieldInfo.capacity;
            await commandUtil.giveFinalCommandResponse(toHandle, {
                ephemeral: false,
                files: [],
                embeds: [],
                components: [],
                content: commandUtil.constructGameDisplayString(game) + ': ' + currentLiveFeed.gameData.venue.name + ' attendance: ' +
                    (attendance && capacity
                        ? attendance.toLocaleString() + ' (' + Math.round((attendance / capacity) * 100) + '% capacity)'
                        : 'Not Available (yet). This data is usually available around the end of the game.')
            });
        }
    },

    weatherHandler: async (interaction) => {
        console.info(`WEATHER command invoked by guild: ${interaction.guildId}`);
        if (!globalCache.values.game.isDoubleHeader) {
            await interaction.deferReply();
        }
        const toHandle = await commandUtil.screenInteraction(interaction);
        if (toHandle) {
            const game = globalCache.values.game.isDoubleHeader
                ? globalCache.values.nearestGames.find(game => game.gamePk === parseInt(toHandle.customId)) // the user's choice between the two games of the double-header.
                : globalCache.values.nearestGames[0];
            const currentLiveFeed = await mlbAPIUtil.liveFeed(game.gamePk, [
                'gameData', 'gameInfo', 'weather', 'condition', 'temp', 'wind', 'venue', 'name'
            ]);
            const weather = currentLiveFeed.gameData.weather;
            await commandUtil.giveFinalCommandResponse(toHandle, {
                ephemeral: false,
                files: [],
                embeds: [],
                components: [],
                content: weather && Object.keys(weather).length > 0
                    ? 'Weather at ' + currentLiveFeed.gameData.venue.name + ':\n' +
                        getWeatherEmoji(weather.condition) + ' ' + weather.condition + '\n' +
                        '\uD83C\uDF21 ' + weather.temp + '°\n' +
                        '\uD83C\uDF43 ' + weather.wind
                    : 'Not available yet - check back an hour or two before game time.'
            });
        }
    }
};

function getWeatherEmoji (condition) {
    switch (condition) {
        case 'Clear':
        case 'Sunny':
            return '\u2600';
        case 'Cloudy':
            return '\u2601';
        case 'Partly Cloudy':
            return '\uD83C\uDF24';
        case 'Dome':
        case 'Roof Closed':
            return '';
        case 'Drizzle':
        case 'Rain':
            return '\uD83C\uDF27';
        case 'Snow':
            return '\u2744';
        case 'Overcast':
            return '\uD83C\uDF2B';
        default:
            return '';
    }
}

function getScoreString (liveFeed, currentPlayJSON) {
    const homeScore = currentPlayJSON.result.homeScore;
    const awayScore = currentPlayJSON.result.awayScore;
    return (currentPlayJSON.about.halfInning === 'top'
        ? '**' + liveFeed.gameData.teams.away.abbreviation + ' ' + awayScore + '**, ' +
        liveFeed.gameData.teams.home.abbreviation + ' ' + homeScore
        : liveFeed.gameData.teams.away.abbreviation + ' ' + awayScore + ', **' +
        liveFeed.gameData.teams.home.abbreviation + ' ' + homeScore + '**');
}
async function streaksHandler(interaction) {
    const streakType = interaction.options.getString('streaktype');
    const streakSpan = interaction.options.getString('streakspan');
    const season = interaction.options.getString('season');
    const sportId = interaction.options.getString('sportid');
    const limit = 10;
  
    try {
      const streaksData = await mlbAPIUtil.getStreaks(streakType, streakSpan, season, limit);
      const streaks = streaksData.stats;
  
      if (!streaks) {
        await interaction.reply(`No streaks found for the specified criteria.`);
        return;
      }
  
      const visual = await commandUtil.generateStreaksVisual(streaks, streakType, streakSpan);
  
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ files: [{ attachment: visual, name: 'streaks.png' }] });
      } else {
        await interaction.followUp({ files: [{ attachment: visual, name: 'streaks.png' }] });
      }
    } catch (error) {
      console.error('Error in streaksHandler:', error);
      // ... (existing error handling)
    }
  }
async function leadersHandler(interaction) {
    const category = interaction.options.getString('category');
    const limit = interaction.options.getInteger('limit') || 10;
    let statGroup = interaction.options.getString('statgroup');
  
    // Check if the category is a pitching stat
    const pitchingStats = [
        'era', 'whip', 'innings_pitched', 'hits_allowed', 'runs_allowed', 'earned_runs',
        'home_runs_allowed', 'walks', 'strikeouts_per_nine', 'walks_per_nine', 'hits_per_nine',
        'strikeouts_per_walk', 'complete_games', 'shutouts', 'hit_batsmen', 'balks',
        'wild_pitches', 'pickoffs', 'inherited_runners', 'inherited_runners_scored',
        'games_finished', 'games_pitched', 'saves', 'holds', 'blown_saves', 'save_opportunities',
        'batters_faced', 'pitches_thrown', 'strikes_thrown', 'strike_percentage', 'first_pitch_strikes',
        'first_pitch_strike_percentage', 'strikeout_percentage', 'strikeout_to_walk_ratio',
        'ground_ball_to_fly_ball_ratio', 'ground_ball_percentage', 'fly_ball_percentage',
        'line_drive_percentage', 'swinging_strike_percentage', 'first_strike_swing_percentage',
        'contact_percentage_in_zone', 'contact_percentage_out_of_zone', 'swings_and_misses',
        'swinging_strike_rate', 'whiff_rate'
      ];
    const isPitchingStat = pitchingStats.includes(category.toLowerCase());
  
    // Set the default stat group based on the category
    if (!statGroup) {
      statGroup = isPitchingStat ? 'pitching' : 'hitting';
    }
  
    try {
      const leadersData = await mlbAPIUtil.getLeaders(category, limit, statGroup);
      const leaders = leadersData.leagueLeaders.find(leaderData => leaderData.statGroup === statGroup)?.leaders;
  
      if (!leaders) {
        await interaction.reply(`No leaders found for the stat group: ${statGroup}`);
        return;
      }
  
      const visual = await commandUtil.generateLeadersVisual(leaders, category);
  
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ files: [{ attachment: visual, name: 'leaders.png' }] });
      } else {
        await interaction.followUp({ files: [{ attachment: visual, name: 'leaders.png' }] });
      }
    } catch (error) {
      console.error('Error in leadersHandler:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply('There was an error fetching the leaders data. Please try again later.');
      } else {
        await interaction.followUp('There was an error fetching the leaders data. Please try again later.');
      }
    }
  }
  async function playerStatsHandler(interaction, playerName, year, splitType) {
    try {
        // Find the player
        const allPlayers = await mlbAPIUtil.getAllPlayers();
        
        // Function to remove diacritics
        const removeDiacritics = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        
        // Normalize the input player name
        const normalizedPlayerName = removeDiacritics(playerName.toLowerCase());
        
        // Find the player with normalized name comparison
        const player = allPlayers.find(p => 
            removeDiacritics(`${p.firstLastName}`.toLowerCase()) === normalizedPlayerName
        );
        
        if (!player) {
            await interaction.editReply(`Player "${playerName}" not found.`);
            return;
        }
        
        const playerId = player.id;
        const playerStats = await mlbAPIUtil.fetchPlayerStats(playerId, year, splitType);
        const visual = await commandUtil.generatePlayerStatsVisual(playerStats, splitType);
        
        // Use followUp if additional messages are needed after the initial reply
        await interaction.followUp({ files: [{ attachment: visual, name: 'player_stats.png' }] });
    } catch (error) {
        console.error('Error in playerStatsHandler:', error);
        // Use editReply or followUp here as well, depending on the situation
        await interaction.editReply('There was an error fetching the player stats. Please try again later.');
    }
  }
function buildPitchingStatsMarkdown (pitchingStats, pitchMix, includeExtra = false) {
    let reply = '\n';
    if (!pitchingStats) {
        reply += 'W-L: -\n' +
            'ERA: -.--\n' +
            'WHIP: -.--' +
            (includeExtra
                ? '\nK/9: -.--\n' +
                    'BB/9: -.--\n' +
                    'H/9: -.--\n' +
                    'HR/9: -.--\n' +
                    'Saves/Opps: -/-'
                : '');
    } else {
        reply += 'W-L: ' + pitchingStats.wins + '-' + pitchingStats.losses + '\n' +
            'ERA: ' + pitchingStats.era + '\n' +
            'WHIP: ' + pitchingStats.whip +
            (includeExtra
                ? '\nK/9: ' + pitchingStats.strikeoutsPer9Inn + '\n' +
                    'BB/9: ' + pitchingStats.walksPer9Inn + '\n' +
                    'H/9: ' + pitchingStats.hitsPer9Inn + '\n' +
                    'HR/9: ' + pitchingStats.homeRunsPer9 + '\n' +
                    'Saves/Opps: ' + pitchingStats.saves + '/' + pitchingStats.saveOpportunities
                : '');
    }
    reply += '\n**Arsenal:**' + '\n';
    if (pitchMix instanceof Error) {
        reply += pitchMix.message;
        return reply;
    }
    if (pitchMix && pitchMix.length > 0 && pitchMix[0].length > 0) {
        reply += (() => {
            let arsenal = '';
            for (let i = 0; i < pitchMix[0].length; i ++) {
                arsenal += pitchMix[0][i] + ' (' + pitchMix[1][i] + '%)' +
                   ': ' + pitchMix[2][i] + ' mph, ' + pitchMix[3][i] + ' BAA' + '\n';
            }
            return arsenal;
        })();
    } else {
        reply += 'No data!';
    }

    return reply;
}
