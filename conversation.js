const redisConf = require('config').get('redis');
const Promise = require('bluebird');
const waiting = require('asyncawait/await');
const async = require('asyncawait/async');

const redis = require('redis');

Promise.promisifyAll(redis.RedisClient.prototype);
Promise.promisifyAll(redis.Multi.prototype);

const redisClient = redis.createClient(redisConf);
const sessionPrefix = 'mafueng-user:';
const _buildKey = (userid) => sessionPrefix + userid;

module.exports = (sessionMaxLength) => { // eslint-disable-line arrow-body-style
  return {
    getContext: async((userid) => {
      const context = waiting(redisClient.getAsync(_buildKey(userid)));
      console.log(`Get context from store ${context}`);
      if (context) {
        const contextJSON = JSON.parse(context);
        if ((new Date()).getTime() - contextJSON.firstReceived < sessionMaxLength) {
          return contextJSON;
        }

        console.log(`Previous session discarded: ${context}`);
        // Use previous language preference
        return { url: context.url };
      }

      return {};
    }),

    updateContext: async((userid, context) => {
      const res = waiting(redisClient.setexAsync(
        [_buildKey(userid), sessionMaxLength, JSON.stringify(context)])
      );
      console.log(`Update context ${userid}: ${res}`);
    }),
  };
};
