const GuildConfig = require('../config/GuildConfig');
const ChannelConfig = require('../config/ChannelConfig');
const Moderation = require('../Moderation');
const AutoResponse = require('../AutoResponse');
const BadWord = require('../BadWord');
const {MessageEmbed, Client, Snowflake} = require('discord.js');
const Exporter = require('./Exporter');

class ModBotImporter {

    /**
     * @type {Client}
     */
    bot;

    /**
     * @type {Snowflake}
     */
    guildID;

    /**
     * @type {Exporter}
     */
    data;
    
    /**
     * @param {Client} bot
     * @param {Snowflake} guildID
     * @param {Exporter} data JSON exported data (modbot-1.0.0)
     */
    constructor(bot, guildID, data) {
        this.bot = bot;
        this.guildID = guildID;
        this.data = data;
    }

    /**
     * import all data to the DB
     * @return {Promise<void>}
     */
    async import() {
        await Promise.all([
            this._importGuildConfig(),
            this._importChannelConfigs(),
            this._importModerations(),
            this._importResponses(),
            this._importBadWords()
        ]);
    }

    _importGuildConfig() {
        const guildConfig = new GuildConfig(this.guildID, this.data.guildConfig);
        return guildConfig.save();
    }

    _importChannelConfigs() {
        const channels = this.data.channels;
        return Promise.all(channels.map(c => ChannelConfig.import(this.bot, this.guildID, c)));
    }

    _importModerations() {
        const moderations = this.data.moderations;
        return Moderation.bulkSave(moderations.map(m => {
            m.guildid = this.guildID;
            return new Moderation(m);
        }));
    }

    _importResponses() {
        const responses = this.data.responses;
        return Promise.all(responses.map(r => (new AutoResponse(this.guildID, r)).save()));
    }

    _importBadWords() {
        const badWords = this.data.badWords;
        return Promise.all(badWords.map(b => (new BadWord(this.guildID, b)).save()));
    }

    generateEmbed() {
        return new MessageEmbed()
            .setTitle('Imported Data')
            .addField('Channel Configs', this.data.channels.length.toString(), true)
            .addField('Moderations', this.data.moderations.length.toString(), true)
            .addField('Responses', this.data.responses.length.toString(), true)
            .addField('BadWords', this.data.badWords.length.toString(), true);
    }
}

module.exports = ModBotImporter;