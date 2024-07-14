const interactionHandlers = require('../modules/interaction-handlers.js');
const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('division_lead')
    .setDescription('View how many days a team has led their division.')
    .addStringOption(option =>
      option.setName('team_name')
        .setDescription('The name of the team (e.g., "Cleveland Guardians").')
        .setRequired(true)),
  async execute(interaction) {
    try {
      // Defer the reply to prevent timeout
      await interaction.deferReply();
      // Execute the handler and wait for it to finish
      await interactionHandlers.divisionLeadHandler(interaction);
      // Edit the initial deferred reply with the actual response
      // Note: This step is handled within the divisionLeadHandler function
      // after processing is complete, typically using interaction.editReply()
    } catch (e) {
      console.error(e);
      // Use editReply here as well if the initial reply was deferred
      await interaction.editReply('There was an error processing this command. If it persists, please reach out to the developer.');
    }
  }
};