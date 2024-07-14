const { SlashCommandBuilder } = require('@discordjs/builders');
const interactionHandlers = require('../modules/interaction-handlers.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaders')
    .setDescription('Get the leaders for a specific stat category and generate a visual.')
    // ... (existing leaders command options)
    .addSubcommand(subcommand =>
      subcommand
        .setName('streaks')
        .setDescription('Get the top 10 longest streaks for a specific stat category.')
        .addStringOption(option =>
          option.setName('streaktype')
            .setDescription('The type of streak to retrieve.')
            .setRequired(true)
            .addChoices(
              { name: 'Hitting Streak Overall', value: 'hittingStreakOverall' },
              { name: 'Hitting Streak Home', value: 'hittingStreakHome' },
              { name: 'Hitting Streak Away', value: 'hittingStreakAway' },
              { name: 'On Base Overall', value: 'onBaseOverall' },
              { name: 'On Base Home', value: 'onBaseHome' },
              { name: 'On Base Away', value: 'onBaseAway' }
            )
        )
        .addStringOption(option =>
          option.setName('streakspan')
            .setDescription('The span of the streak.')
            .setRequired(true)
            .addChoices(
              { name: 'Career', value: 'career' },
              { name: 'Season', value: 'season' },
              { name: 'Current Streak', value: 'currentStreak' },
              { name: 'Current Streak In Season', value: 'currentStreakInSeason' },
              { name: 'Notable', value: 'notable' },
              { name: 'Notable In Season', value: 'notableInSeason' }
            )
        )
        .addStringOption(option =>
          option.setName('season')
            .setDescription('The season for the streaks.')
            .setRequired(false)
        )
    ),
  async execute(interaction) {
    try {
      if (interaction.options.getSubcommand() === 'streaks') {
        await interactionHandlers.streaksHandler(interaction);
      } else {
        await interactionHandlers.leadersHandler(interaction);
      }
    } catch (e) {
      console.error(e);
      // ... (existing error handling)
    }
  }
};