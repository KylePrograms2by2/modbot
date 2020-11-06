const ChatTriggeredFeature = require('./ChatTriggeredFeature');
const Discord = require('discord.js');

/**
 * Database
 * @type {Database}
 */
let database;

/**
 * Config cache time (ms)
 * @type {Number}
 */
const cacheDuration = 10*60*1000;

/**
 * channel wide autoresponses
 * @type {module:"discord.js".Collection}
 */
const channelResponses = new Discord.Collection();

/**
 * guild wide autoresponses
 * @type {module:"discord.js".Collection}
 */
const guildResponses = new Discord.Collection();

/**
 * Class representing an auto response
 */
class AutoResponse extends ChatTriggeredFeature {

  /**
   * constructor - create an auto response
   * @param {module:"discord.js".Snowflake}     gid               guild ID
   * @param {Object}                            json              options
   * @param {Trigger}                           json.trigger      filter that triggers the response
   * @param {String}                            json.response     message to send to the channel
   * @param {Boolean}                           json.global       does this apply to all channels in this guild
   * @param {module:"discord.js".Snowflake[]}   [json.channels]   channels that this applies to
   * @param {Number}                            [id]              id in DB
   * @return {AutoResponse} the auto response
   */
  constructor(gid, json, id) {
    super(id);
    this.gid = gid;

    if (json) {
      this.trigger = json.trigger;
      this.response = json.response;
      this.global = json.global;
      this.channels = json.channels;
    }

    if (!this.channels) {
      this.channels = [];
    }
  }

  /**
   * serialize the response
   * @returns {(*|string)[]}
   */
  serialize() {
    return [this.gid, JSON.stringify(this.trigger), this.response, this.global, this.channels.join(',')];
  }

  /**
   * Save this response to db and cache
   * @async
   * @return {Promise<Number>} id in db
   */
  async save() {
    if (!this.channels) {this.channels = null;}

    let dbentry = await database.queryAll("INSERT INTO responses (`guildid`, `trigger`, `response`, `global`, `channels`) VALUES (?,?,?,?,?)",this.serialize());

    this.id = dbentry.insertId;

    if (this.global) {
      if (!guildResponses.has(this.gid)) guildResponses.set(this.gid, new Discord.Collection())
      guildResponses.get(this.gid).set(this.id, this);
    }
    else {
      for (const channel of this.channels) {
        if(!channelResponses.has(channel)) channelResponses.set(channel, new Discord.Collection());
        channelResponses.get(channel).set(this.id, this);
      }
    }

    return dbentry.insertId;
  }

  /**
   * remove this response from cache and db
   * @async
   * @returns {Promise<void>}
   */
  async remove() {
    await database.query("DELETE FROM responses WHERE id = ?",[this.id]);

    if (this.global) {
      guildResponses.get(this.gid).delete(this.id);
    }
    else {
      for (const channel of this.channels) {
        channelResponses.get(channel).delete(this.id);
      }
    }
  }

  /**
   * generate an Embed displaying the info of this response
   * @param {String}        title
   * @param {Number}        color
   * @returns {module:"discord.js".MessageEmbed}
   */
  embed(title, color) {
    return new Discord.MessageEmbed()
        .setTitle(title + ` [${this.id}]`)
        .setColor(color)
        .addFields(
            /** @type {any} */[
          {name: "Trigger", value: `${this.trigger.type}: \`${this.trigger.type === 'regex' ? '/' + this.trigger.content + '/' + this.trigger.flags : this.trigger.content}\``},
          {name: "Response", value: this.response.substring(0,1000)},
          {name: "Channels", value: this.global ? "global" : this.channels.map(c => `<#${c}>`).join(', ')}
        ]);
  }

  /**
   * save database
   * @param {Database} db
   */
  static init(db) {
    database = db;
  }

  /**
   * Get responses for a channel
   * @async
   * @param {module:"discord.js".Snowflake} channelId
   * @param {module:"discord.js".Snowflake} guildId
   * @return {module:"discord.js".Collection<Number,AutoResponse>}
   */
  static async getAutoResponses(channelId, guildId) {

    if (!channelResponses.has(channelId)) {
      await AutoResponse.refreshChannelResponses(channelId);
    }

    if (!guildResponses.has(guildId)) {
      await AutoResponse.refreshGuildResponses(guildId);
    }

    return channelResponses.get(channelId).concat(guildResponses.get(guildId)).sort((a, b) => a.id - b.id);
  }

  /**
   * Get all responses for a guild
   * @async
   * @param {module:"discord.js".Snowflake} guildId
   * @return {module:"discord.js".Collection<Number,AutoResponse>}
   */
  static async getAllAutoResponses(guildId) {

    const result = await database.queryAll("SELECT * FROM responses WHERE guildid = ?", [guildId]);

    const responses = new Discord.Collection();
    for (const res of result) {
      responses.set(res.id, new AutoResponse(res.guildid, {
        trigger: JSON.parse(res.trigger),
        response: res.response,
        global: res.global === 1,
        channels: res.channels.split(',')
      }, res.id));
    }

    return responses.sort((a, b) => a.id - b.id);
  }

  /**
   * Reload responses cache for a guild
   * @async
   * @param {module:"discord.js".Snowflake} guildId
   */
  static async refreshGuildResponses(guildId) {
    const result = await database.queryAll("SELECT * FROM responses WHERE guildid = ? AND global = TRUE", [guildId]);

    const newResponses = new Discord.Collection();
    for (const res of result) {
      const o = new AutoResponse(res.guildid, {
        trigger: JSON.parse(res.trigger),
        response: res.response,
        global: true,
        channels: []
      }, res.id);
      newResponses.set(res.id, o);
    }
    guildResponses.set(guildId, newResponses);
    setTimeout(() => {
      guildResponses.delete(guildId);
    },cacheDuration);
  }

  /**
   * Reload responses cache for a channel
   * @async
   * @param {module:"discord.js".Snowflake} channelId
   */
  static async refreshChannelResponses(channelId) {
    const result = await database.queryAll("SELECT * FROM responses WHERE channels LIKE ?", [`%${channelId}%`]);

    const newResponses = new Discord.Collection();
    for (const res of result) {
      newResponses.set(res.id, new AutoResponse(res.guildid, {
        trigger: JSON.parse(res.trigger),
        response: res.response,
        global: false,
        channels: res.channels.split(',')
      }, res.id));
    }
    channelResponses.set(channelId, newResponses);
    setTimeout(() => {
      channelResponses.delete(channelId);
    },cacheDuration);
  }

}

module.exports = AutoResponse;
