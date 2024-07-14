const globalCache = require('./global-cache');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const AsciiTable = require('ascii-table');
const mlbAPIUtil = require('./MLB-API-util');
const jsdom = require('jsdom');
const globals = require('../config/globals');
const puppeteer = require('puppeteer');
const LOGGER = require('./logger')(process.env.LOG_LEVEL?.trim() || globals.LOG_LEVEL.INFO);
const formatStat = (value, decimalPlaces = 2) => {
    if (typeof value === 'number') {
      // First, round the number to the specified decimal places
      const roundedValue = Math.round(value * Math.pow(10, decimalPlaces)) / Math.pow(10, decimalPlaces);
      // Convert to string using toFixed to ensure decimal places are preserved
      const stringValue = roundedValue.toFixed(decimalPlaces);
      // Remove leading zeros by converting back to a number, then to a string
      // If the result is an integer (e.g., 1172.00), parseFloat will remove trailing zeros
      return parseFloat(stringValue).toString();
    }
    return value;
  };
  
module.exports = {getBullpenUsageScreenshot,generateLeadersVisual,generateStreaksVisual,
    generatePlayerStatsVisual,
    buildSeasonStatsHTML: (pitchingStats) => {
        if (!pitchingStats) {
          return `
            <p>
              <span class="label">W-L:</span> - |
              <span class="label">ERA:</span> -.-- |
              <span class="label">WHIP:</span> -.-- |
              <span class="label">IP:</span> - |
              <span class="label">K:</span> - |
              <span class="label">BB:</span> -
            </p>
          `;
        }
        return `
          <p>
            <span class="label">W-L:</span> ${pitchingStats.wins}-${pitchingStats.losses} |
            <span class="label">ERA:</span> ${formatStat(pitchingStats.era)} |
            <span class="label">WHIP:</span> ${formatStat(pitchingStats.whip)} |
            <span class="label">IP:</span> ${formatStat(pitchingStats.inningsPitched, 1)} |
            <span class="label">K:</span> ${pitchingStats.strikeOuts} |
            <span class="label">BB:</span> ${pitchingStats.baseOnBalls}
          </p>
        `;
      },    getLineupCardTable: async (game) => {
    const lineup = game.teams.home.team.id === parseInt(process.env.TEAM_ID)
        ? game.lineups.homePlayers
        : game.lineups.awayPlayers;
    const people = (await mlbAPIUtil.people(lineup.map(lineupPlayer => lineupPlayer.id))).people;

    let tableRows = `
        <tr>
            <th>Name</th>
            <th>B</th>
            <th>HR</th>
            <th>RBI</th>
            <th>AVG</th>
            <th>OBP</th>
            <th>SLG</th>
            <th>OPS</th>
        </tr>
    `;

    lineup.forEach((player, index) => {
        const playerData = people.find(p => p.id === player.id);
        if (!playerData) {
            console.log(`No data found for player ${player.fullName}`);
            return;
        }

        const hittingStats = playerData.stats?.find(stat => stat.group.displayName === 'hitting')?.splits[0]?.stat;

        tableRows += `
            <tr>
                <td>${playerData.fullName}</td>
                <td>${playerData.batSide.code}</td>
                <td>${hittingStats?.homeRuns || hittingStats?.homeRuns === 0 ? hittingStats?.homeRuns : '-'}</td>
                <td>${hittingStats?.rbi || hittingStats?.rbi === 0 ? hittingStats?.rbi : '-'}</td>
                <td>${hittingStats?.avg || '-'}</td>
                <td>${hittingStats?.obp || '-'}</td>
                <td>${hittingStats?.slg || '-'}</td>
                <td>${hittingStats?.ops || '-'}</td>
            </tr>
        `;
    });

    console.log('Final table:', tableRows);

    // Assuming getScreenshotOfSplitTables is implemented to handle the screenshot generation
    return await getScreenshotOfSplitTables([tableRows]);
},
    
      buildPitchArsenalHTML: (pitchMix) => {
        let html = '<ul>';
        if (pitchMix instanceof Error) {
          html += `<li>${pitchMix.message}</li>`;
        } else if (pitchMix && pitchMix.length > 0 && pitchMix[0].length > 0) {
          for (let i = 0; i < pitchMix[0].length; i++) {
            html += `<li>${pitchMix[0][i]} (${pitchMix[1][i]}%): ${formatStat(pitchMix[2][i], 1)} mph, ${pitchMix[3][i]} BAA</li>`;
          }
        } else {
          html += '<li>No data available</li>';
        }
        html += '</ul>';
        return html;
      },
    
      buildComparisonTableHTML: (homePitchingStats, awayPitchingStats) => {
        const stats = ['wins', 'losses', 'era', 'whip', 'inningsPitched', 'strikeOuts', 'baseOnBalls'];
        const labels = ['Wins', 'Losses', 'ERA', 'WHIP', 'IP', 'K', 'BB'];
        
        let html = '';
        stats.forEach((stat, index) => {
          html += `
            <tr>
              <td>${labels[index]}</td>
              <td>${formatStat(homePitchingStats[stat], stat === 'inningsPitched' ? 1 : 2)}</td>
              <td>${formatStat(awayPitchingStats[stat], stat === 'inningsPitched' ? 1 : 2)}</td>
            </tr>
          `;
        });
        return html;
      }
    ,  
     
    getLineupSplitsTable: async (lineup, playerSplitsData, playerSeasonData, pitcherId, pitcherName) => {
        let tableRows = `
            <tr>
                <th>Name</th>
                <th>Games</th>
                <th>Season AVG</th>
                <th>Season OBP</th>
                <th>Season SLG</th>
                <th>LHP AVG</th>
                <th>LHP OBP</th>
                <th>LHP SLG</th>
                <th>LHP HR</th>
                <th>RHP AVG</th>
                <th>RHP OBP</th>
                <th>RHP SLG</th>
                <th>RHP HR</th>
                <th>AVG vs. ${pitcherName}</th> <!-- Updated column for Hits vs. Pitcher stats -->
                <th>Hits vs. ${pitcherName}</th> <!-- Updated column -->
                <th>PA vs. ${pitcherName}</th> <!-- Updated column --> 
            </tr>
        `;
    
        if (!playerSplitsData || !Array.isArray(playerSplitsData)) {
            throw new Error('Invalid playerSplitsData: Missing or invalid "people" array');
        }
    
        for (const player of lineup) {
            const playerData = playerSplitsData.find(p => p.id === player.id);
            const playerSeason = playerSeasonData.find(p => p.id === player.id); // Fetching playerSeasonData
        
            if (!playerData || !playerSeason) {
                console.log(`No data found for player ${player.fullName}`);
                continue;
            }
        
            let batterVsPitcherStats = await mlbAPIUtil.batterStatsVsPitcher(player.id, pitcherId);
        
            let seasonStats = playerSeason.stats[0].splits[0].stat; // Using playerSeasonData for season stats
            let vsLHP, vsRHP = '-';
            let gamesPlayed = seasonStats?.gamesPlayed || '-';
        
            if (playerData.stats) {
                const hittingStats = playerData.stats.find(s => s.type.displayName === 'statSplits' && s.group.displayName === 'hitting');
        
                if (hittingStats && Array.isArray(hittingStats.splits)) {
                    vsLHP = hittingStats.splits.find(s => s.season === "2024" && s.split.code === "vl")?.stat;
                    vsRHP = hittingStats.splits.find(s => s.season === "2024" && s.split.code === "vr")?.stat;
                }
        
                tableRows += `
                    <tr>
                        <td>${player.fullName}</td>
                        <td>${gamesPlayed}</td>
                        <td>${seasonStats?.avg || '-'}</td>
                        <td>${seasonStats?.obp || '-'}</td>
                        <td>${seasonStats?.slg || '-'}</td>
                        <td>${vsLHP?.avg || '-'}</td>
                        <td>${vsLHP?.obp || '-'}</td>
                        <td>${vsLHP?.slg || '-'}</td>
                        <td>${vsLHP?.homeRuns || '0'}</td>
                        <td>${vsRHP?.avg || '-'}</td>
                        <td>${vsRHP?.obp || '-'}</td>
                        <td>${vsRHP?.slg || '-'}</td>
                        <td>${vsRHP?.homeRuns || '0'}</td>
                        <td>${batterVsPitcherStats?.people?.[0]?.stats?.[0]?.splits?.[0]?.stat?.avg || 'N/A'}</td>
                        <td>${batterVsPitcherStats?.people?.[0]?.stats?.[0]?.splits?.[0]?.stat?.hits || 'N/A'}</td>
                        <td>${batterVsPitcherStats?.people?.[0]?.stats?.[0]?.splits?.[0]?.stat?.plateAppearances || 'N/A'}</td>
                    </tr>
                `;
            } else {
                console.log(`Skipping data for player ${player.fullName} due to missing stats.`);
            }
        };
        
        console.log('Final table:', tableRows);
        
        return await getScreenshotOfSplitTables([tableRows]);
    },
    hydrateProbable: async (probable) => {
        const [spot, savant, people] = await Promise.all([
            new Promise((resolve, reject) => {
                if (probable) {
                    resolve(mlbAPIUtil.spot(probable));
                } else {
                    resolve(Buffer.from(
                        `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="60" cy="60" r="60" />
                    </svg>`));
                }
                reject(new Error('There was a problem getting the player spot.'));
            }),
            mlbAPIUtil.savantPitchData(probable),
            new Promise((resolve, reject) => {
                if (probable) {
                    resolve(mlbAPIUtil.people([probable]));
                } else {
                    resolve(undefined);
                }
                reject(new Error('There was a problem getting stats for this person.'));
            })

        ]);
        return {
            spot,
            pitchMix: savant instanceof Error ? savant : getPitchCollections(new jsdom.JSDOM(savant)),
            pitchingStats: parsePitchingStats(people),
            handedness: people?.people[0].pitchHand?.code
        };
    },

    hydrateHitter: async (hitter) => {
        const [spot, stats] = await Promise.all([
            new Promise((resolve, reject) => {
                if (hitter) {
                    resolve(mlbAPIUtil.spot(hitter));
                } else {
                    resolve(Buffer.from(
                        `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="60" cy="60" r="60" />
                    </svg>`));
                }
                reject(new Error('There was a problem getting the player spot.'));
            }),
            new Promise((resolve, reject) => {
                if (hitter) {
                    resolve(mlbAPIUtil.hitter(hitter));
                } else {
                    resolve(undefined);
                }
                reject(new Error('There was a problem getting stats for this person.'));
            })

        ]);
        return {
            spot,
            stats
        };
    },
    
    formatSplits: (season, splitStats, lastXGamesStats) => {
        const vsLeft = (splitStats.splits.find(split => split?.split?.code === 'vl' && !split.team)
            || splitStats.splits.find(split => split?.split?.code === 'vl'));
        const vsRight = (splitStats.splits.find(split => split?.split?.code === 'vr' && !split.team)
            || splitStats.splits.find(split => split?.split?.code === 'vr')
        );
        const risp = (splitStats.splits.find(split => split?.split?.code === 'risp' && !split.team)
            || splitStats.splits.find(split => split?.split?.code === 'risp')
        );
        const lastXGames = (lastXGamesStats.splits.find(split => !split.team) || lastXGamesStats.splits[0]);
        const seasonStats = (season.splits.find(split => !split.team) || season.splits[0]);
        return '\n### ' +
            seasonStats.stat.avg + '/' + seasonStats.stat.obp + '/' + seasonStats.stat.slg +
            ', ' + seasonStats.stat.homeRuns + ' HR, ' + seasonStats.stat.rbi + ' RBIs' +
            '\n\nSplits:\n\n' +
        '**Last 7 Games**' + (lastXGames ? ' (' + lastXGames.stat.plateAppearances + ' ABs)\n' : '\n') + (
            lastXGames
                ? lastXGames.stat.avg + '/' + lastXGames.stat.obp + '/' + lastXGames.stat.slg
                : 'No at-bats!'
        ) + '\n\n**vs. Righties**' + (vsRight ? ' (' + vsRight.stat.plateAppearances + ' ABs)\n' : '\n') + (
            vsRight
                ? vsRight.stat.avg + '/' + vsRight.stat.obp + '/' + vsRight.stat.slg
                : 'No at-bats!'
        ) + '\n\n**vs. Lefties**' + (vsLeft ? ' (' + vsLeft.stat.plateAppearances + ' ABs)\n' : '\n') + (
            vsLeft
                ? vsLeft.stat.avg + '/' + vsLeft.stat.obp + '/' + vsLeft.stat.slg
                : 'No at-bats!'
        ) + '\n\n**with RISP**' + (risp ? ' (' + risp.stat.plateAppearances + ' ABs)\n' : '\n') + (
            risp
                ? risp.stat.avg + '/' + risp.stat.obp + '/' + risp.stat.slg
                : 'No at-bats!'
        );
    },  
    constructGameDisplayString: (game) => {
        // Enhanced to handle more variations in the game object structure and ensure robust date formatting
        const homeTeamAbbreviation = game.teams?.home?.team?.abbreviation || game.teams?.home?.abbreviation || game.gameData?.teams?.home?.abbreviation;
        const awayTeamAbbreviation = game.teams?.away?.team?.abbreviation || game.teams?.away?.abbreviation || game.gameData?.teams?.away?.abbreviation;
        const gameDate = game.gameDate || game.datetime?.dateTime || game.gameData?.datetime?.dateTime;
    
        // Ensure the date is correctly handled, considering the possibility of undefined or null values
        const formattedDate = gameDate ? new Date(gameDate).toLocaleString('default', {
            month: 'short',
            day: 'numeric',
            timeZone: 'America/New_York',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short'
        }) : 'Date not available';
    
        return `${homeTeamAbbreviation} vs. ${awayTeamAbbreviation}, ${formattedDate}`;
    },buildPitchingMatchupImage: async (game, hydratedHomeProbable, hydratedAwayProbable, probables) => {
        console.log("Building pitching matchup image with probables:", hydratedHomeProbable);
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--allow-file-access-from-files', '--enable-local-file-accesses'
        ]
    });
    const [page] = await browser.pages();
    await page.goto('about:blank');

    
    const awaypitcherStatsXStart = new Promise((resolve, reject) => {
        mlbAPIUtil.pitcherLastThree(probables.awayProbable)
            .then(data => resolve(data))
            .catch(error => reject(new Error('There was a problem getting the away pitcher stats.')));
    });
    const homepitcherStatsXStart = new Promise((resolve, reject) => {
        mlbAPIUtil.pitcherLastThree(probables.homeProbable)
            .then(data => resolve(data))
            .catch(error => reject(new Error('There was a problem getting the away pitcher stats.')));
    });
    const htmlContent = `
    <html>
    <head>
    <style>
    body {
      background-color: #0E1117; 
      color: #C9D1D9;
      font-family: sans-serif;
      padding: 30px;
      width: 880px;
    }
    h1 {
      text-align: center;
      margin-bottom: 20px;
      font-size: 24px; /* Reduced from default size */
    }
    h2, h3 {
      text-align: center;
      margin-bottom: 20px;
    }
    .matchup {
      display: flex;
      justify-content: space-between;
      flex-wrap: nowrap;
      margin-bottom: 30px;
      padding: 0 20px;
    }
    .pitcher {
      width: 48%;
      border: 1px solid #30363D;
      border-radius: 6px;
      padding: 20px;
      background-color: #161B22;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      text-align: center;
    }
    .pitcher-info {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
    }
    .pitcher img {
      width: 80px;
      height: 80px; 
      border-radius: 50%;
      margin-right: 15px;
      border: 2px solid #FFFFFF;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }
    .pitcher h2 {
      margin: 0;
      color: #58A6FF;
    }
    .stats, .last-3-starts, .pitch-arsenal {
      text-align: center;
      margin-top: 20px;
    }
    .stats p, .last-3-starts p {
      text-align: center;
      margin: 5px 0;
      font-size: 20px; /* Increased from default size */
    }
    .label {
      color: #8B949E;
    }
    .stat-group {
        white-space: nowrap;
        margin: 0 5px;
      }
    .comparison {
      width: 100%;
      margin-top: 30px;
    }
    .comparison table {
      width: 100%;
      border-collapse: collapse;
    }
    .comparison th, .comparison td {
      border: 1px solid #30363D;
      padding: 10px;
      text-align: center;
    }
    .comparison th {
      background-color: #161B22;
    }
    ul {
      list-style-type: none;
      padding-left: 0;
    }
    .pitch-arsenal {
      text-align: center;
    }
    .pitch-arsenal ul {
      display: inline-block;
      text-align: left;
      font-size: 16px; /* Increased from default size */
    }
  </style>
  </head>
    <body>
      <h1>Pitching Matchup - ${module.exports.constructGameDisplayString(game)}</h1>
      <div class="matchup">  
        <div class="pitcher">
          <div class="pitcher-info">
            <img src="https://midfield.mlbstatic.com/v1/people/${probables.homeProbable}/spots/120" />
            <h2>${hydratedHomeProbable.handedness}HP ${probables.homeProbableFirstName ? probables.homeProbableFirstName + ' ' : ''}${probables.homeProbableLastName || 'TBD'} </h2>
          </div>
          <div class="stats">
            <h3>Season Stats</h3>
            ${module.exports.buildPitchingStatsHTML(hydratedHomeProbable.pitchingStats)}
            
           
          </div>
          <div class="last-3-starts">
            <h3>Last 3 Starts</h3>
            ${module.exports.buildPitchingStatsLast3HTML(await homepitcherStatsXStart)}
          </div>
          <h3>Pitch Arsenal</h3>
          ${module.exports.buildPitchArsenalHTML(hydratedHomeProbable.pitchMix)}
        </div>
        <div class="pitcher">
          <div class="pitcher-info">
            <img src="https://midfield.mlbstatic.com/v1/people/${probables.awayProbable}/spots/120" />
            <h2>${hydratedAwayProbable.handedness}HP ${probables.awayProbableFirstName ? probables.awayProbableFirstName + ' ' : ''}${probables.awayProbableLastName || 'TBD'} </h2>
          </div>
          <div class="stats">
            <h3>Season Stats</h3>
            ${module.exports.buildPitchingStatsHTML(hydratedAwayProbable.pitchingStats)}
            

          </div>
          <div class="last-3-starts">
            <h3>Last 3 Starts</h3>
            ${module.exports.buildPitchingStatsLast3HTML(await awaypitcherStatsXStart)}
          </div>
          <h3>Pitch Arsenal</h3>
          ${module.exports.buildPitchArsenalHTML(hydratedAwayProbable.pitchMix)}
        </div>

      </div>
      
    </body>
    </html>
`;

    await page.setContent(htmlContent);
    await page.waitForSelector('.matchup');

    const matchupImage = await page.screenshot({ fullPage: true });
    await browser.close();

    return matchupImage;
},

buildPitchingStatsHTML: (pitchingStats) => {
    let html = '';
    if (!pitchingStats) {
        html += `
            <p>
                <span class="stat-group"><span class="label">W-L:</span> -</span>
                <span class="stat-group"><span class="label">ERA:</span> -.--</span>
                <span class="stat-group"><span class="label">WHIP:</span> -.--</span>
            </p>
        `;
    } else {
        html += `
            <p>
                <span class="stat-group"><span class="label">W-L:</span> ${pitchingStats.wins}-${pitchingStats.losses}</span>
                <span class="stat-group"><span class="label">ERA:</span> ${pitchingStats.era}</span>
                <span class="stat-group"><span class="label">WHIP:</span> ${pitchingStats.whip}</span>
                <span class="stat-group"><span class="label">IP:</span> ${pitchingStats.inningsPitched}</span>
                <span class="stat-group"><span class="label">K:</span> ${pitchingStats.strikeOuts}</span>
                <span class="stat-group"><span class="label">BB:</span> ${pitchingStats.baseOnBalls}</span>
            </p>
        `;
    }
    return html;
},

buildPitchingStatsLast3HTML: (data) => {
    console.log("Received data for pitching stats:", data);
  
    let html = '';
  
    if (!data || !data.people || data.people.length === 0 || !data.people[0].stats) {
        html += `
            <p>No pitching stats available for the last 3 starts.</p>
        `;
    } else {
        const stats = data.people[0].stats.find(stat => stat.type.displayName === 'lastXGames')?.splits[0]?.stat;
  
        if (stats) {
            html += `
                <p>
                    <span class="stat-group"><span class="label">W-L:</span> ${stats.wins}-${stats.losses}</span>
                    <span class="stat-group"><span class="label">ERA:</span> ${stats.era}</span>
                    <span class="stat-group"><span class="label">WHIP:</span> ${stats.whip}</span>
                    <span class="stat-group"><span class="label">IP:</span> ${stats.inningsPitched}</span>
                    <span class="stat-group"><span class="label">K:</span> ${stats.strikeOuts}</span>
                    <span class="stat-group"><span class="label">BB:</span> ${stats.baseOnBalls}</span>
                </p>
            `;
        } else {
            html += `
                <p>No pitching stats available for the last 3 starts.</p>
            `;
        }
    }
  
    return html;
},
    buildLineScoreTable: async (game, linescore) => {
        const awayAbbreviation = game.teams.away.team?.abbreviation || game.teams.away.abbreviation;
        const homeAbbreviation = game.teams.home.team?.abbreviation || game.teams.home.abbreviation;
        let innings = linescore.innings;
        if (innings.length > 9) { // extras - just use the last 9 innings.
            innings = innings.slice(innings.length - 9);
        }
        const linescoreTable = new AsciiTable();
        const headings = [''];
        linescoreTable.setHeading(headings.concat(innings.map(inning => inning.num)).concat(['', 'R', 'H', 'E', 'LOB']));
        linescoreTable.addRow([awayAbbreviation]
            .concat(innings.map(inning => inning.away.runs)).concat(
                ['', linescore.teams.away.runs, linescore.teams.away.hits, linescore.teams.away.errors, linescore.teams.away.leftOnBase]));
        linescoreTable.addRow([homeAbbreviation]
            .concat(innings.map(inning => inning.home.runs))
            .concat(['', linescore.teams.home.runs, linescore.teams.home.hits, linescore.teams.home.errors, linescore.teams.home.leftOnBase]));
        linescoreTable.removeBorder();
        const inningState = linescore.outs < 3
            ? (linescore.inningHalf === 'Bottom' ? 'Bot' : 'Top')
            : (linescore.inningHalf === 'Top' ? 'Mid' : 'End');
        return (await getScreenshotOfLineScore(
            [linescoreTable],
            linescore.currentInningOrdinal,
            inningState,
            linescore.teams.away.runs,
            linescore.teams.home.runs,
            awayAbbreviation,
            homeAbbreviation
        ));
    },

    buildBoxScoreTable: async (game, boxScore, boxScoreNames, status) => {
        const tables = [];
        const players = boxScore.teams.away.team.id === parseInt(process.env.TEAM_ID)
            ? boxScore.teams.away.players
            : boxScore.teams.home.players;
        const sortedBattingOrder = Object.keys(players)
            .filter(playerKey => players[playerKey].battingOrder)
            .map(batterKey => {
                return {
                    id: players[batterKey].person.id,
                    allPositions: players[batterKey].allPositions,
                    summary: players[batterKey].stats?.batting?.summary?.replaceAll(' | ', ' '),
                    boxScoreName: boxScoreNames.gameData.players[batterKey].boxscoreName,
                    battingOrder: players[batterKey].battingOrder,
                    isSubstitute: players[batterKey].gameStatus?.isSubstitute
                };
            })
            .sort((a, b) => parseInt(a.battingOrder) > parseInt(b.battingOrder) ? 1 : -1);
        const pitcherIDs = boxScore.teams.away.team.id === parseInt(process.env.TEAM_ID)
            ? boxScore.teams.away.pitchers
            : boxScore.teams.home.pitchers;
        const inOrderPitchers = pitcherIDs.map(pitcherID => ((pitcher) => {
            return {
                id: pitcher.person.id,
                summary: pitcher.stats?.pitching?.summary,
                note: pitcher.stats?.pitching?.note,
                boxScoreName: boxScoreNames.gameData.players['ID' + pitcher.person.id].boxscoreName
            };
        })(players['ID' + pitcherID]));

        const boxScoreTable = new AsciiTable('Batting\n');
        sortedBattingOrder.forEach((batter) => {
            boxScoreTable.addRow(
                (batter.isSubstitute ? '- ' + batter.boxScoreName : batter.boxScoreName),
                batter.allPositions.reduce((acc, value) => acc + (batter.allPositions.indexOf(value) === batter.allPositions.length - 1
                    ? value.abbreviation
                    : value.abbreviation + '-'), ''),
                batter.summary
            );
        });
        boxScoreTable.removeBorder();
        const pitchingTable = new AsciiTable('Pitching\n');
        inOrderPitchers.forEach(pitcher => pitchingTable.addRow(pitcher.boxScoreName + ' ' + (pitcher.note || ''), pitcher.summary));
        pitchingTable.removeBorder();
        tables.push(boxScoreTable);
        tables.push(pitchingTable);
        return (await getScreenshotOfHTMLTables(tables));
    },

    buildStandingsTable: async (standings, divisionName) => {
        const centralMap = standings.teamRecords.map(teamRecord => {
            return {
                name: teamRecord.team.name,
                wins: teamRecord.leagueRecord.wins,
                losses: teamRecord.leagueRecord.losses,
                pct: teamRecord.leagueRecord.pct,
                gamesBack: teamRecord.gamesBack,
                homeRecord: (() => {
                    const home = teamRecord.records.splitRecords.find(record => record.type === 'home');
                    return home.wins + '-' + home.losses;
                })(),
                awayRecord: (() => {
                    const away = teamRecord.records.splitRecords.find(record => record.type === 'away');
                    return away.wins + '-' + away.losses;
                })(),
                lastTen: (() => {
                    const l10 = teamRecord.records.splitRecords.find(record => record.type === 'lastTen');
                    return l10.wins + '-' + l10.losses;
                })()
            };
        });
        const table = new AsciiTable(divisionName + '\n');
        table.setHeading('Team', 'W-L', 'GB', 'L10');
        centralMap.forEach((entry) => table.addRow(
            entry.name,
            entry.wins + '-' + entry.losses,
            entry.gamesBack,
            entry.lastTen
        ));
        table.removeBorder();
        return (await getScreenshotOfHTMLTables([table]));
    },
    
    screenInteraction: async (interaction) => {
        if (globalCache.values.nearestGames instanceof Error) {
            await interaction.followUp({
                content: "There's no game today!",
                ephemeral: false
            });
        } else if (globalCache.values.game.isDoubleHeader) {
            return await resolveDoubleHeaderSelection(interaction);
        } else {
            return interaction;
        }
    },

    giveFinalCommandResponse: async (toHandle, options) => {
        await (globalCache.values.game.isDoubleHeader
            ? toHandle.update(options)
            : toHandle.followUp(options));
    },


    getAbbreviations: (game) => {
        return {
            home: (game.teams?.home?.team?.abbreviation || game.teams?.home?.abbreviation || game.gameData?.teams?.home?.abbreviation),
            away: (game.teams?.away?.team?.abbreviation || game.teams?.away?.abbreviation || game.gameData?.teams?.away?.abbreviation)
        };
    }
};

function getPitchCollections (dom) {
    const pitches = [];
    const percentages = [];
    const MPHs = [];
    const battingAvgsAgainst = [];
    dom.window.document
        .querySelectorAll('tbody tr td:nth-child(2)').forEach(el => pitches.push(el.textContent.trim()));
    dom.window.document
        .querySelectorAll('tbody tr td:nth-child(6)').forEach(el => percentages.push(el.textContent.trim()));
    dom.window.document
        .querySelectorAll('tbody tr td:nth-child(7)').forEach(el => MPHs.push(el.textContent.trim()));
    dom.window.document
        .querySelectorAll('tbody tr td:nth-child(18)').forEach(el => battingAvgsAgainst.push(
            (el.textContent.trim().length > 0 ? el.textContent.trim() : 'N/A')
        ));
    return [pitches, percentages, MPHs, battingAvgsAgainst];
}
module.exports.generateBullpenUsageTable = (data) => {
    // Calculate dates for the last five days and format them as day names
    const dates = [];
    for (let i = 5; i > 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        dates.push(date.toLocaleDateString('en-US', { weekday: 'long' }));
    }

    // Generate the table with dynamic day name headers
    let tableHTML = `
        <table>
            <tr>
                <th>Player</th>
                <th>${dates[0]}</th>
                <th>${dates[1]}</th>
                <th>${dates[2]}</th>
                <th>${dates[3]}</th>
                <th>${dates[4]}</th>
                <th>Last 3</th>
                <th>Last 5</th>
            </tr>
    `;

    
    data.forEach(player => {
        tableHTML += `
            <tr>
                <td>${player.player}</td>
                <td>${player.fri}</td>
                <td>${player.sat}</td>
                <td>${player.sun}</td>
                <td>${player.mon}</td>
                <td>${player.tues}</td>
                <td>${player.last3}</td>
                <td>${player.last5}</td>
            </tr>
        `;
    });
    
    tableHTML += '</table>';
    
    return tableHTML;
};
async function resolveDoubleHeaderSelection (interaction) {
    const buttons = globalCache.values.nearestGames.map(game =>
        new ButtonBuilder()
            .setCustomId(game.gamePk.toString())
            .setLabel(new Date(game.gameDate).toLocaleString('en-US', {
                timeZone: 'America/New_York',
                hour: 'numeric',
                minute: '2-digit',
                timeZoneName: 'short'
            }))
            .setStyle(ButtonStyle.Primary)
    );
    const response = await interaction.reply({
        content: 'Today is a double-header. Which game?',
        components: [new ActionRowBuilder().addComponents(buttons)]
    });
    const collectorFilter = i => i.user.id === interaction.user.id;
    try {
        LOGGER.trace('awaiting');
        return await response.awaitMessageComponent({ filter: collectorFilter, time: 10_000 });
    } catch (e) {
        await interaction.editReply({ content: 'Game selection not received within 10 seconds - request was canceled.', components: [] });
    }
}
async function getBullpenUsageScreenshot(tableHTML) {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });
    const page = await browser.newPage();
  
    const content = `
      <html>
        <head>
          <style>
            body {
              background-color: #0E1117; 
              color: #C9D1D9;
              font-family: sans-serif;
              padding: 30px;
              width: 100%;
            }
            table {
              border-collapse: collapse;
              width: 100%;
            }
            th, td {
              border: 1px solid #30363D;
              padding: 8px;
              text-align: left;
            }
            th {
              background-color: #161B22;
            }
            tr:nth-child(even) {
              background-color: #161B22;
            }
          </style>
        </head>
        <body>
          ${tableHTML}
        </body>
      </html>
    `;
  
    await page.setContent(content);
    const screenshot = await page.screenshot({ fullPage: false });
    await browser.close();
  
    return screenshot;
  }
async function getScreenshotOfSplitTables(tables) {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });
    const page = await browser.newPage();

    const tableHTML = `
        <style>
            body, html {
            background-color: #151820; /* Ensure the whole page has the same background */
            width: 100%;
            height: 100%;
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
        }
            table {
                border-collapse: collapse;
                background-color: #151820;
                color: whitesmoke;
                font-size: 18px;
                text-align: center;
            }
            th, td {
                padding: 10px;
                border: 1px solid #444;
            }
            th {
                background-color: #1c2025;
            }
            .table-container {
                display: flex;
                justify-content: center;
                padding: 0;
                margin: 0;
                width: stretch_both;
                height: stretch_both;
            }
        </style>
        <div class="table-container">
            <table>
                ${tables.reduce((acc, value) => acc + value, '')}
            </table>
        </div>
    `;

    await page.setContent(tableHTML);

    // Get the dimensions of the table
    const tableDimensions = await page.evaluate(() => {
        const table = document.querySelector('table');
        return {
            width: table.offsetWidth,
            height: table.offsetHeight,
        };
    });

    // Set the viewport size to match the table dimensions
    await page.setViewport({
        width: tableDimensions.width,
        height: tableDimensions.height,
        deviceScaleFactor: 1,
    });

    const screenshot = await page.screenshot({ fullPage: false });
    await browser.close();

    return screenshot;
}
function parsePitchingStats (people) {
    return people?.people[0]?.stats?.find(stat => stat?.group?.displayName === 'pitching')?.splits[0]?.stat;
}

/* This is not the best solution, admittedly. We are building an HTML version of the table in a headless browser, styling
it how we want, and taking a screenshot of that, attaching it to the reply as a .png. Why? Trying to simply reply with ASCII
is subject to formatting issues on phone screens, which rudely break up the characters and make the tables look like gibberish.
 */

async function getScreenshotOfHTMLTables (tables) {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });
    const page = await browser.newPage();
    await page.setContent(`
            <pre id="boxscore" style="background-color: #151820;
                color: whitesmoke;
                padding: 15px;
                font-size: 20px;
                width: fit-content;">` +
            tables.reduce((acc, value) => acc + value.toString() + '\n\n', '') +
            '</pre>');
    const element = await page.waitForSelector('#boxscore');
    const buffer = await element.screenshot({
        type: 'png',
        omitBackground: false
    });
    await browser.close();
    return buffer;
}
async function generateStreaksVisual(streaks, streakType, streakSpan) {
    // Generate the HTML content for the streaks visual
    const htmlContent = await formatStreaksAsHTML(streaks, streakType, streakSpan);
  
    // Use Puppeteer to generate an image from the HTML content
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent);
    const visual = await page.screenshot({
      type: 'png',
      omitBackground: false,
      fullPage: true
    });
    await browser.close();
  
    return visual;
  }
  
  async function formatStreaksAsHTML(streaks, streakType, streakSpan) {
    const topStreak = streaks[0];
    const { player, team, streak } = topStreak;
    const playerImageBuffer = await mlbAPIUtil.spot(player.id);
    const playerImageBase64 = Buffer.from(playerImageBuffer).toString('base64');
    const playerImageSrc = `data:image/png;base64,${playerImageBase64}`;
  
    const streaksRows = streaks.slice(1).map((streakData, index) => `
      <tr>
        <td>${index + 2}</td>
        <td>${streakData.player.fullName}</td>
        <td>${streakData.team.name}</td>
        <td>${streakData.streak}</td>
      </tr>
    `).join('');
  
    const htmlContent = `
      <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              background-color: #121212;
              color: #e0e0e0;
              margin: 0;
              padding: 20px;
            }
            .streaks-card {
              background-color: #1e1e1e;
              border-radius: 10px;
              padding: 20px;
              box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
              text-align: center;
              margin-bottom: 20px;
            }
            .streak-player {
              font-size: 24px;
              font-weight: bold;
              margin-bottom: 10px;
            }
            .streak-team {
              font-size: 18px;
              margin-bottom: 20px;
              color: #888;
            }
            .streak-image {
              width: 150px;
              height: 150px;
              border-radius: 50%;
              object-fit: cover;
              margin-bottom: 20px;
            }
            .streak-value {
              font-size: 36px;
              font-weight: bold;
              margin-bottom: 10px;
            }
            .streak-info {
              font-size: 18px;
              color: #888;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 20px;
            }
            th, td {
              padding: 10px;
              text-align: left;
              border-bottom: 1px solid #444;
            }
            th {
              background-color: #333;
            }
          </style>
        </head>
        <body>
          <div class="streaks-card">
            <img src="${playerImageSrc}" alt="${player.fullName}" class="streak-image" />
            <div class="streak-player">${player.fullName}</div>
            <div class="streak-team">${team.name}</div>
            <div class="streak-value">${streak}</div>
            <div class="streak-info">${streakType} (${streakSpan})</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Team</th>
                <th>Streak</th>
              </tr>
            </thead>
            <tbody>
              ${streaksRows}
            </tbody>
          </table>
        </body>
      </html>
    `;
  
    return htmlContent;
  }
async function generateLeadersVisual(leader, category) {
    // Generate the HTML content for the leaders visual
    const htmlContent = await formatLeadersAsHTML(leader, category);
  
    // Use Puppeteer to generate an image from the HTML content
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent);
    const visual = await page.screenshot({
      type: 'png',
      omitBackground: false,
      fullPage: true
    });
    await browser.close();
  
    return visual;
  }
  
  async function formatLeadersAsHTML(leadersData, category) {
    console.log('Leaders Data:', leadersData); // Log the leadersData object
    const leaders = leadersData; // Directly use the leadersData array
    const season = leaders[0].season;
  
    console.log('Leaders:', leaders); // Log the leaders array
  
    const topLeader = leaders[0]; // Get the top leader from the first element of the array
    const { person, team, value } = topLeader;
    const playerImageBuffer = await mlbAPIUtil.spot(person.id);
    const playerImageBase64 = Buffer.from(playerImageBuffer).toString('base64');
    const playerImageSrc = `data:image/png;base64,${playerImageBase64}`;
  
    const runnersUpRows = leaders.slice(1).map((leader, index) => `
      <tr>
        <td>${index + 2}</td>
        <td>${leader.person.fullName}</td>
        <td>${leader.team.name}</td>
        <td>${leader.value}</td>
      </tr>
    `).join('');
  
    console.log('Runners Up Rows:', runnersUpRows); // Log the runnersUpRows string

  const htmlContent = `
    <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #121212;
            color: #e0e0e0;
            margin: 0;
            padding: 20px;
          }
          .leaders-card {
            background-color: #1e1e1e;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
            text-align: center;
            margin-bottom: 20px;
          }
          .leader-name {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
          }
          .leader-team {
            font-size: 18px;
            margin-bottom: 20px;
            color: #888;
          }
          .leader-image {
            width: 150px;
            height: 150px;
            border-radius: 50%;
            object-fit: cover;
            margin-bottom: 20px;
          }
          .leader-value {
            font-size: 36px;
            font-weight: bold;
            margin-bottom: 10px;
          }
          .leader-category {
            font-size: 18px;
            color: #888;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
          }
          th, td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid #444;
          }
          th {
            background-color: #333;
          }
        </style>
      </head>
      <body>
        <div class="leaders-card">
          <img src="${playerImageSrc}" alt="${person.fullName}" class="leader-image" />
          <div class="leader-name">${person.fullName}</div>
          <div class="leader-team">${team.name}</div>
          <div class="leader-value">${value}</div>
          <div class="leader-category">${category.toUpperCase()} Leader (${season} Season)</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Team</th>
              <th>${category.toUpperCase()}</th>
            </tr>
          </thead>
          <tbody>
            ${runnersUpRows}
          </tbody>
        </table>
      </body>
    </html>
  `;

  return htmlContent;
}

async function generateLeadersVisual(leader, category) {
    // Generate the HTML content for the leaders visual
    const htmlContent = await formatLeadersAsHTML(leader, category);
  
    // Use Puppeteer to generate an image from the HTML content
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent);
    const visual = await page.screenshot({
      type: 'png',
      omitBackground: false,
      fullPage: true
    });
    await browser.close();
  
    return visual;
  }
  
  async function formatLeadersAsHTML(leadersData, category) {
    console.log('Leaders Data:', leadersData); // Log the leadersData object
    const leaders = leadersData; // Directly use the leadersData array
    const season = leaders[0].season;
  
    console.log('Leaders:', leaders); // Log the leaders array
  
    const topLeader = leaders[0]; // Get the top leader from the first element of the array
    const { person, team, value } = topLeader;
    const playerImageBuffer = await mlbAPIUtil.spot(person.id);
    const playerImageBase64 = Buffer.from(playerImageBuffer).toString('base64');
    const playerImageSrc = `data:image/png;base64,${playerImageBase64}`;
  
    const runnersUpRows = leaders.slice(1).map((leader, index) => `
      <tr>
        <td>${index + 2}</td>
        <td>${leader.person.fullName}</td>
        <td>${leader.team.name}</td>
        <td>${leader.value}</td>
      </tr>
    `).join('');
  
    console.log('Runners Up Rows:', runnersUpRows); // Log the runnersUpRows string

  const htmlContent = `
    <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #121212;
            color: #e0e0e0;
            margin: 0;
            padding: 20px;
          }
          .leaders-card {
            background-color: #1e1e1e;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
            text-align: center;
            margin-bottom: 20px;
          }
          .leader-name {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
          }
          .leader-team {
            font-size: 18px;
            margin-bottom: 20px;
            color: #888;
          }
          .leader-image {
            width: 150px;
            height: 150px;
            border-radius: 50%;
            object-fit: cover;
            margin-bottom: 20px;
          }
          .leader-value {
            font-size: 36px;
            font-weight: bold;
            margin-bottom: 10px;
          }
          .leader-category {
            font-size: 18px;
            color: #888;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
          }
          th, td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid #444;
          }
          th {
            background-color: #333;
          }
        </style>
      </head>
      <body>
        <div class="leaders-card">
          <img src="${playerImageSrc}" alt="${person.fullName}" class="leader-image" />
          <div class="leader-name">${person.fullName}</div>
          <div class="leader-team">${team.name}</div>
          <div class="leader-value">${value}</div>
          <div class="leader-category">${category.toUpperCase()} Leader (${season} Season)</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Team</th>
              <th>${category.toUpperCase()}</th>
            </tr>
          </thead>
          <tbody>
            ${runnersUpRows}
          </tbody>
        </table>
      </body>
    </html>
  `;

  return htmlContent;
}
async function generatePlayerStatsVisual(playerStats,splitType) {
    const htmlContent = await formatPlayerStatsAsHTML(playerStats,splitType);

    // Use Puppeteer to generate an image from the HTML content
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent);
    const visual = await page.screenshot({
        type: 'png',
        omitBackground: false,
        fullPage: true
    });
    await browser.close();

    return visual;
}

async function formatPlayerStatsAsHTML(playerStats, splitType, splitValue) {
    const player = playerStats;
    const { stats } = player;
    const fullName = player.fullName;
    const personId = player.id;
    const splitTitle = splitType.replace(/_/g, ' ').toUpperCase();
    let battingStats = {};
    let pitchingStats = {};

    // Updated function to get the correct split based on splitType and splitValue
    const getCorrectSplit = (splits, splitType, splitValue) => {
        if (splitType === 'season') {
            return splits.find(s => !s.split || s.split.code === 'total');
        } else if (splitType && splitValue) {
            const sitCode = {
'vl': 'vs_left',
'vr': 'vs_right',
'l': 'batting_left',
'r': 'batting_right',
'vls': 'vs_left_starter',
'vrs': 'vs_right_starter',
'h1': 'first_half',
'h2': 'second_half',
'd1': 'yesterday',
'd7': 'last_7_days',
'd30': 'last_30_days'
            }[splitValue.toLowerCase()];

            return splits.find(s => s.split && s.split.code.toLowerCase() === sitCode.toLowerCase());
        }
        return splits[0]; // Default to first split if no match
    };

    stats.forEach(statGroup => {
        const { type, group, splits } = statGroup;
        

            const relevantSplit = getCorrectSplit(splits, splitType, splitValue);
            if (relevantSplit) {
                const { stat } = relevantSplit;
                if (group.displayName === "hitting") {
                    battingStats = { ...battingStats, ...stat };
                } else if (group.displayName === "pitching") {
                    pitchingStats = { ...pitchingStats, ...stat };
                }
            }
        
    });
    const batting_stat_mapping = {
        'avg': 'AVG',
        'baseOnBalls': 'BB',
        'doubles': '2B',
        'hits': 'H',
        'homeRuns': 'HR',
        'obp': 'OBP',
        'ops': 'OPS',
        'rbi': 'RBI',
        'runs': 'R',
        'slg': 'SLG',
        'stolenBases': 'SB',
        'strikeOuts': 'SO',
        'totalBases': 'TB',
        'triples': '3B',
        'gamesPlayed': 'G',
    };

    const pitching_stat_mapping = {
        'era': 'ERA',
        'whip': 'WHIP',
        'inningsPitched': 'IP',
        'wins': 'W',
        'losses': 'L',
        'saves': 'SV',
        'strikeOuts': 'SO',
        'baseOnBalls': 'BB',
        'hits': 'H',
        'earnedRuns': 'ER',
        'homeRuns': 'HR',
        'strikeoutsPer9Inn': 'K/9',
        'walksPer9Inn': 'BB/9',
        'hitsPer9Inn': 'H/9',
        'gamesPlayed': 'G',
    };
    // Function to remove leading zeros from stat values
const preFormatStat = (value) => {
    if (typeof value === 'string' && value.startsWith('0')) {
      return value.replace(/^0+/, '');
    }
    return value;
  };
  
  // Preprocess stats to remove leading zeros
  const preprocessStats = (stats) => {
    Object.keys(stats).forEach(key => {
      stats[key] = preFormatStat(stats[key]);
    });
  };
  
  // Assuming battingStats and pitchingStats are defined earlier
  preprocessStats(pitchingStats);

    const isBatterPrimary = (battingStats.gamesPlayed || 0) > (pitchingStats.gamesPlayed || 0);
    const primaryStats = isBatterPrimary ? battingStats : pitchingStats;
    const primaryStatType = isBatterPrimary ? "Batting" : "Pitching";
    const statMapping = isBatterPrimary ? batting_stat_mapping : pitching_stat_mapping;
    const playerImageBuffer = await mlbAPIUtil.spot(personId);
    const playerImageBase64 = Buffer.from(playerImageBuffer).toString('base64');
    const playerImageSrc = `data:image/png;base64,${playerImageBase64}`;
const nlAllStars = await mlbAPIUtil.getAllNlAllstars();
const alAllStars = await mlbAPIUtil.getAllAlAllstars();
console.log(nlAllStars);
console.log(alAllStars);
const isPlayerAllStar = nlAllStars.awards.some(allStar => allStar.player.id === personId) || 
                        alAllStars.awards.some(allStar => allStar.player.id === personId);
    const splitDisplays = {
        'vl': 'vs Left-Handed Pitchers',
        'vr': 'vs Right-Handed Pitchers',
        'l': 'Batting Left',
        'r': 'Batting Right',
        'vls': 'vs Left-Handed Starting Pitchers',
        'vrs': 'vs Right-Handed Starting Pitchers'
    };
    const htmlContent = `
    <html>
        <head>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background-color: #121212;
                    color: #e0e0e0;
                    margin: 0;
                    padding: 20px;
                }
                .player-card {
                    background-color: #1e1e1e;
                    border-radius: 10px;
                    padding: 20px;
                    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
                    text-align: center;
                }
                .player-name {
                    font-size: 50px;
                    font-weight: bold;
                    margin-bottom: 10px;
                }
                                    .split-type {
                    font-size: 18px;
                    margin-bottom: 20px;
                    color: #888;
                }
                .player-image {
                    width: 200px;
                    height: 200px;
                    border-radius: 50%;
                    object-fit: cover;
                    margin-bottom: 20px;
                }
                .stats-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 40px;
                }
                .stats-table th,
                .stats-table td {
                    padding: 8px;
                    text-align: center;
                    justify-content: space-between;
                    border-bottom: 1px solid #444;
                    font-size: 35px;
                }
                .stats-table th {
                    background-color: #333;
                    font-size: 38px;
                }
            </style>
        </head>
        <body>
            <div class="player-card">
                <img src="${playerImageSrc}" alt="${fullName}" class="player-image"/>
                <div class="player-name">${fullName}${isPlayerAllStar ? ' ★' : ''}</div>
                <div class="split-type">${splitType === 'season' ? 'Season Stats' : splitTitle || 'Custom Split'}</div>
               
                <table class="stats-table">
                    <thead>
                        <tr>
                            <th colspan="2">${primaryStatType} Stats</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.entries(primaryStats)
                            .filter(([stat]) => statMapping.hasOwnProperty(stat))
                            .map(([stat, value]) => `
                                <tr>
                                    <td>${statMapping[stat]}</td>
                                    <td>${formatStat(value)}</td>
                                </tr>
                            `)
                            .join('')}
                    </tbody>
                </table>
            </div>
        </body>
    </html>
    `;
    return htmlContent;
}

// Helper function to get player image
async function getPlayerImageBase64(personId) {
    const playerImageBuffer = await mlbAPIUtil.spot(personId);
    return Buffer.from(playerImageBuffer).toString('base64');
}

async function getScreenshotOfLineScore (tables, inning, half, awayScore, homeScore, awayAbbreviation, homeAbbreviation) {
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });
    const page = await browser.newPage();
    await page.setContent(`
            <style>
                #home-score, #away-score, #home-abb, #away-abb {
                    font-size: 35px;
                }
                #boxscore {
                    margin: 0;
                }
                #header-inning {
                    font-size: 16px;
                }
            </style>
            <div id="line-score-container" style="
                    background-color: #151820;
                    color: whitesmoke;
                    padding: 15px;
                    font-size: 20px;
                    width: fit-content;">
                <div id="line-score-header" style="display: flex;
                    width: 100%;
                    justify-content: space-evenly;
                    align-items: center;
                    font-family: monospace;
                    margin-bottom: 2em;">
                    <div id="away-abb">` + awayAbbreviation + `</div>
                    <div id="away-score">` + awayScore + `</div>
                    <div id="header-inning">` + half + ' ' + inning + `</div>
                    <div id="home-score">` + homeScore + `</div>
                    <div id="home-abb">` + homeAbbreviation + `</div>
                </div>
                <pre id="boxscore">` +
                    tables.reduce((acc, value) => acc + value.toString() + '\n\n', '') +
                `</pre>
            </div>`);
    const element = await page.waitForSelector('#line-score-container');
    const buffer = await element.screenshot({
        type: 'png',
        omitBackground: false
    });
    await browser.close();
    return buffer;
}
