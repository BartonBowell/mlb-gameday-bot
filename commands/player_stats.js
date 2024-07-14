const { SlashCommandBuilder } = require('@discordjs/builders');
const interactionHandlers = require('../modules/interaction-handlers.js');
module.exports = {
  data: new SlashCommandBuilder()
    .setName('player_stats')
    .setDescription('Get a player\'s stat line and generate a visual.')
    .addStringOption(option =>
      option.setName('player_name')
        .setDescription('The first and last name of the player (e.g., "Mike Trout").')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('split_type')
        .setDescription('The type of split to retrieve.')
        .setRequired(false)
        .addChoices(
          { name: 'Season', value: 'season' },
          { name: 'vs Left-handed Pitchers', value: 'vs_left' },
          { name: 'vs Right-handed Pitchers', value: 'vs_right' },
          { name: 'Batting Left', value: 'batting_left' },
          { name: 'Batting Right', value: 'batting_right' }
        )),

  async execute(interaction) {
    try {
      // Defer the reply immediately
      await interaction.deferReply();
      
      const playerName = interaction.options.getString('player_name');
      const year = interaction.options.getString('year') || new Date().getFullYear().toString();
      const splitType = interaction.options.getString('split_type') || 'season';

      await interactionHandlers.playerStatsHandler(interaction, playerName, year, splitType);
    } catch (e) {
      console.error('Error in player_stats command:', e);
      if (interaction.deferred) {
        await interaction.editReply('An error occurred while processing the command. Please try again later.');
      } else {
        await interaction.reply({ content: 'An error occurred while processing the command. Please try again later.', ephemeral: true });
      }
    }
  }
};