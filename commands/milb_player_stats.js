const { SlashCommandBuilder } = require('@discordjs/builders');
const interactionHandlers = require('../modules/interaction-handlers.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('milb_player_stats')
    .setDescription('Get a player\'s stat line and generate a visual.')
    .addStringOption(option =>
      option.setName('player_name')
        .setDescription('The first and last name of the player (e.g., "Jonny Farmelo").')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('league')
        .setDescription('The league of the player.')
        .setRequired(true)
        .addChoices(
          { name: 'Triple-A', value: '11' },
          { name: 'Double-A', value: '12' },
          { name: 'High-A', value: '13' },
          { name: 'Low-A', value: '14' },
          { name: 'Rookie', value: '16' },
          { name: 'Winter Leagues', value: '17' }
        ))
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
      await interaction.deferReply();
      
      const playerName = interaction.options.getString('player_name');
      const year = interaction.options.getString('year') || new Date().getFullYear().toString();
      const splitType = interaction.options.getString('split_type') || 'season';
      const league = interaction.options.getString('league');

      await interactionHandlers.milbPlayerStatsHandler(interaction, playerName, year, splitType, league);
    } catch (e) {
      console.error('Error in milb_player_stats command:', e);
      if (interaction.deferred) {
        await interaction.editReply('An error occurred while processing the command. Please try again later.');
      } else {
        await interaction.reply({ content: 'An error occurred while processing the command. Please try again later.', ephemeral: true });
      }
    }
  }
};