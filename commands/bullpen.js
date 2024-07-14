const { SlashCommandBuilder } = require('@discordjs/builders');
const interactionHandlers = require('../modules/interaction-handlers.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bullpen')
        .setDescription('View the current bullpen usage for the Seattle Mariners.'),
    async execute(interaction) {
        try {
            await interactionHandlers.bullpenHandler(interaction);
        } catch (e) {
            console.error(e);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply('There was an error processing this command. If it persists, please reach out to the developer.');
            } else if (interaction.deferred) {
                await interaction.followUp('There was an error processing this command. If it persists, please reach out to the developer.');
            }
        }
    }
};