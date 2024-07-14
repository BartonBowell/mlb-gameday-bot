const { SlashCommandBuilder } = require('discord.js');
const handlers = require('../modules/interaction-handlers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lineup-splits')
        .setDescription('Get the lineup splits for the current game'),
    async execute(interaction) {
        await handlers.lineupSplitsHandler(interaction);
    },
};