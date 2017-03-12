const waiting = require('asyncawait/await');
const async = require('asyncawait/async');
const Promise = require('bluebird');
const _ = require('lodash');

const config = require('config');
const i18n = require('i18n');

i18n.configure(_.merge({}, config.get('i18n')));

const PAYLOAD_NEW_PIN = 'new_pin';
const PAYLOAD_CONTACT_US = 'contact_us';
const PAYLOAD_ENGLISH = 'english';
const PAYLOAD_THAI = 'thai';

const STATE_DISABLED = 'disabled';
const STATE_WAIT_INTENT = 'wait_intent';
const STATE_WAIT_IMG = 'wait_image';
const STATE_WAIT_LOCATION = 'wait_location';
const STATE_WAIT_LOCATION_DETAIL = 'wait_location_detail';
const STATE_WAIT_DESC = 'wait_desc';
const STATE_WAIT_TAGS = 'wait_tags';

const categories = [
  'repair',
  'service',
  'it',
  'suggestion',
  'classroom',
  'safety',
  'sanitary',
  'traffic',
  'others',
];

module.exports = (m, api, conversation, apiUserId) => {
  function tagReplies(context) {
    const tags = [m.createQuickReplyButton(context.__('#done'), 'isEnding')];

    const categoryTags = _.map(categories, cat =>
      m.createQuickReplyButton(`#${context.__(cat)}`, cat)
    );

    return tags.concat(categoryTags);
  }


  function greet(userid, context) {
    const buttons = [
      m.createPostbackButton(context.__('Report an issue'), PAYLOAD_NEW_PIN),
      m.createPostbackButton(context.__('Contact us'), PAYLOAD_CONTACT_US),
    ];

    if (context.language === 'en') {
      buttons.push(m.createPostbackButton(context.__('Please say in Thai'), PAYLOAD_THAI));
    } else {
      buttons.push(m.createPostbackButton(context.__('Please say in Thai'), PAYLOAD_ENGLISH));
    }

    m.sendButton(
      userid,
      context.__('Hi {{name}}! What would you like to do today?',
        { name: context.profile.first_name }
      ),
      buttons
    );
  }

  function addPhotos(attachments, context) {
    attachments = _.filter(attachments, (item) =>
      _.includes(['image', 'video'], item.type)
    );

    return Promise.map(attachments, (item) =>
      new Promise((resolve) => {
        // This could be a link to photo or video
        api.uploadPhotoFromURL(item.payload.url, (res) => {
          item.payload.url = res.url;
          resolve(item);
        });
      })
    ).each((item) => {
      let type = 'videos';
      if (item.type === 'image') {
        type = 'photos';
      }
      context[type].push(item.payload.url);
    });
  }

  function processText(messageText, context) {
    // Sanitize string
    messageText = messageText.trim().replace(/[\s\n\r]+/g, ' ');

    let isEnding = false;
    let endPos = -1;

    // Check if the message contains the ending string and strip it off
    endPos = messageText.indexOf(context.__('#done'));
    if (endPos >= 0) {
      isEnding = true;
      messageText = messageText.substr(0, endPos);
    }

    if (messageText.length > 0) {
      if (context.desc) {
        context.desc.push(messageText);
        context.descLength += messageText.length;
      } else {
        context.desc = [messageText];
        context.descLength = messageText.length;
      }

      const hashtags = [];
      // Hacky solution -- regex gets too complicated with unicode characters.
      // https://github.com/twitter/twitter-text/blob/master/js/twitter-text.js
      const tokens = messageText.split(' ');
      tokens.forEach(str => {
        if (str[0] === '#' || str[0] === '＃') {
          hashtags.push(str.substr(1));
        }
      });

      if (hashtags.length > 0) {
        context.hashtags.push.apply(context.hashtags, hashtags);
      }
    }

    return isEnding;
  }

  const enterNull = async((event, context) => {
    const userid = event.sender.id;

    // New session
    context.firstReceived = event.timestamp;

    const profile = waiting(new Promise((resolve) => {
      m.getProfile(userid, resolve);
    }));

    context.profile = profile;
    context.lastSent = (new Date()).getTime();
    context.state = STATE_WAIT_INTENT;

    greet(userid, context);
  });

  const enterWaitIntent = async((event, context) => {
    const userid = event.sender.id;
    const postback = event.postback ? event.postback.payload : undefined;

    if (postback === PAYLOAD_NEW_PIN) {
      context.lastSent = (new Date()).getTime();

      m.sendText(userid, context.__("Awesome, let's get started!"));

      waiting(new Promise((resolve) => {
        setTimeout(() => {
          context.lastSent = (new Date()).getTime();
          context.state = STATE_WAIT_IMG;
          context.photos = [];
          context.videos = [];

          m.sendText(
            userid,
            context.__('First, can you send me photos or videos of the issue you found?')
          );
          resolve();
        }, 1000);
      }));
    } else if (postback === PAYLOAD_CONTACT_US) {
      context.lastSent = (new Date()).getTime();
      context.state = STATE_DISABLED;

      m.sendText(
        userid,
        context.__('You can leave us messages, ' +
          'and our staff will get back to you as soon as possible.')
      );
    } else {
      m.sendText(userid, context.__('Slow down, could you please answer my question first?'));
    }
  });

  const enterWaitImg = async((event, context) => {
    const userid = event.sender.id;
    const message = event.message;
    const messageText = message ? message.text : undefined;
    const isSticker = message ? !!message.sticker_id : false;
    const attachments = message ? message.attachments : undefined;

    const isSkipping = messageText && (messageText.indexOf(context.__('#skip')) >= 0);

    if (isSkipping || attachments) {
      if (isSkipping ||
        (!isSticker && (attachments[0].type === 'image' || attachments[0].type === 'video'))) {
        if (!isSkipping) {
          context.lastSent = (new Date()).getTime();
          m.sendText(userid, context.__('(Y) Sweet!'));

          waiting(addPhotos(attachments, context));
        }
        waiting(new Promise((resolve) => {
          setTimeout(() => {
            context.lastSent = (new Date()).getTime();
            context.state = STATE_WAIT_LOCATION;

            m.sendTextWithLocationPrompt(
              userid,
              context.__(
                'Next, can you help us locate the issue by sharing the location ' +
                'using Facebook Messenger App on your mobile phone? ' +
                'You can move the map around to pin the exact location ' +
                'or pick a place from the list.'
              )
            );
            resolve();
          }, 1000);
        }));
      } else {
        m.sendText(
          userid,
          context.__("Just photos or videos please. I'm getting confused! 😓")
        );
      }
    } else {
      m.sendTextWithReplies(
        userid,
        context.__("If you really don't have photos or videos, you may skip this step."),
        [m.createQuickReplyButton(context.__('#skip'), 'isSkipping')]
      );
    }
  });

  const enterWaitLocation = async((event, context) => {
    const userid = event.sender.id;
    const message = event.message;
    const messageText = message ? message.text : undefined;
    const isSticker = message ? !!message.sticker_id : false;
    const attachments = message ? message.attachments : undefined;

    const isSkipping = messageText && (messageText.indexOf(context.__('#skip')) >= 0);

    if (isSkipping || (attachments && attachments[0].type === 'location')) {
      if (!isSkipping) {
        context.lastSent = (new Date()).getTime();
        m.sendText(userid, context.__('🚩 Ahh, got it.'));

        const point = attachments[0].payload.coordinates;
        context.location = [point.lat, point.long];
        context.locationTitle = attachments[0].title;
        if (context.locationTitle === 'Pinned Location' ||
          context.locationTitle === 'ตำแหน่งที่ตั้งที่ปักหมุดไว้') {
          context.locationTitle = '';
        }
      } else {
        context.location = undefined;
        context.locationTitle = '';
      }

      waiting(new Promise((resolve) => {
        setTimeout(() => {
          context.lastSent = (new Date()).getTime();
          context.state = STATE_WAIT_LOCATION_DETAIL;
          m.sendTextWithReplies(
            userid,
            context.__(
              'Any additional detail of the location, like floor or room number, ' +
              'would be great!'
            ),
            [m.createQuickReplyButton(context.__('#skip'), 'isSkipping')]
          );
          resolve();
        }, 1000);
      }));
    } else if (!isSticker && attachments && attachments.length > 0 &&
      (attachments[0].type === 'image' || attachments[0].type === 'video')) {
      // Add photos/videos
      context.lastSent = (new Date()).getTime();
      m.sendText(userid, context.__("(Y) Cool! Don't forget to send me the location."));
      waiting(addPhotos(attachments, context));
    } else {
      m.sendTextWithReplies(
        userid,
        context.__("If you really can't input location, you may skip this step."),
        [m.createQuickReplyButton(context.__('#skip'), 'isSkipping')]
      );
    }
  });

  const enterWaitLocationDetail = async((event, context) => {
    const userid = event.sender.id;
    const message = event.message;
    const messageText = message ? message.text : undefined;
    const isSkipping = messageText && (messageText.indexOf(context.__('#skip')) >= 0);

    if (messageText) {
      if (!isSkipping) {
        context.locationDesc = messageText;
      }
      context.lastSent = (new Date()).getTime();
      m.sendText(userid, context.__('Great, thank you.'));

      waiting(new Promise((resolve) => {
        setTimeout(() => {
          context.lastSent = (new Date()).getTime();
          context.state = STATE_WAIT_DESC;
          context.hashtags = [];

          m.sendText(
            userid,
            context.__("Alright, can you explain the issue you'd like to report today? " +
              'Please make it as detailed as possible.')
          );
          resolve();
        }, 1000);
      }));
    }
  });

  const enterWaitDesc = async((event, context) => {
    const userid = event.sender.id;
    const message = event.message;
    const messageText = message ? message.text : undefined;
    const isSticker = message ? !!message.sticker_id : false;
    const attachments = message ? message.attachments : undefined;

    if (messageText) {
      const isEnding = processText(messageText, context);

      if (isEnding) {
        context.state = STATE_WAIT_TAGS;
        context.categories = [];
        m.sendTextWithReplies(
          userid,
          context.__(
            'Could you please help me select appropriate categories for the issue? ' +
            'You can pick one from the list below or type #<category> for a custom category.'
          ),
          tagReplies(context).slice(1)
        );
      } else {
        if (context.desc.length === 1) {
          // After 1st response
          context.lastSent = (new Date()).getTime();
          m.sendTextWithReplies(
            userid,
            context.__("You can keep on typing! Send '#done' when you finish so that " +
             'we can proceed to the next step.'),
            _.take(tagReplies(context), 1)
          );
        } else if (context.descLength > 140) {
          context.lastSent = (new Date()).getTime();
          m.sendTextWithReplies(
            userid,
            context.__("Done? If not, don't worry, I'm still listening."),
            _.take(tagReplies(context), 1)
          );
        } else {
          m.sendTextWithReplies(
            userid,
            '',
            _.take(tagReplies(context), 1)
          );
        }
      }
    } else if (!isSticker && attachments) {
      if (attachments[0].type === 'image' || attachments[0].type === 'video') {
        // Add photos/videos
        context.lastSent = (new Date()).getTime();
        m.sendText(userid, context.__('The photos/videos have been added.'));
        addPhotos(attachments, context);
      } else if (attachments[0].type === 'location') {
        context.lastSent = (new Date()).getTime();
        m.sendText(userid, context.__('🚩 The location has been updated.'));
        const point = attachments[0].payload.coordinates;
        context.location = [point.lat, point.long];
      }
    }
  });

  const enterWaitTags = async((event, context) => {
    const userid = event.sender.id;
    const message = event.message;
    const messageText = message ? message.text : undefined;
    if (messageText) {
      if (message.quick_reply) {
        if (message.quick_reply.payload !== 'isEnding') {
          context.categories.push(message.quick_reply.payload);
        }
      }

      const isEnding = processText(messageText, context);

      if (isEnding) {
        context.lastSent = (new Date()).getTime();

        m.sendText(
          userid,
          context.__('Thank you very much, {{name}}. Your issue has been ' +
            'submitted. We will notify the team as soon as possible.',
            { name: context.profile.first_name }
          )
        );
        const desc = context.desc.join(' ');
        const user = context.profile;
        user.facebook_id = userid;
        const res = waiting(new Promise((resolve) => {
          const data = {
            categories: context.categories,
            created_time: (new Date()).getTime(),
            detail: desc,
            location: {
              coordinates: context.location,
              title: context.locationTitle,
              desc: context.locationDesc,
            },
            owner: apiUserId,
            user,
            photos: context.photos,
            provider: apiUserId,
            status: 'unverified',
            tags: context.hashtags,
            organization: '583ddb7a3db23914407f9b58',
          };
          console.log(data);
          api.postPin(data, resolve);
        }));
        const pinId = res._id;
        const elements = [{
          title: 'iCare - Chula Engineering',
          subtitle: desc,
          item_url: `http://mafueng.youpin.city/pins/${pinId}`,
          image_url: context.photos[0] ||
            'https://mafueng.youpin.city/public/image/logo-l.png',
        }];
        m.sendGeneric(userid, elements);
        waiting(conversation.updateContext(userid, {}));
      } else {
        context.lastSent = (new Date()).getTime();
        m.sendTextWithReplies(
          userid,
          context.__('Anything else? You can keep adding more tags.'),
          tagReplies(context)
        );
      }
    }
  });

  return {
    onMessaged: async((event) => {
      console.log(event);

      const userid = event.sender.id;

      const message = event.message;
      const messageText = message ? message.text : undefined;
      const postback = event.postback ? event.postback.payload : undefined;

      // eslint-disable-next-line
      let context = waiting(conversation.getContext(userid));

      // console.log('---- Loaded previous context');
      // console.log(context);

      // Override context
      if (messageText === '#เริ่มใหม่' || postback === PAYLOAD_THAI) {
        context = { url: '/?lang=th' };
      } else if (postback === PAYLOAD_ENGLISH) {
        context = { url: '/?lang=en' };
      }

      i18n.init(context);
      context.lastReceived = event.timestamp;

      if (context.state === STATE_DISABLED) {
        return;
      }

      switch (context.state) {
        case STATE_WAIT_INTENT:
          waiting(enterWaitIntent(event, context));
          break;
        case STATE_WAIT_IMG:
          waiting(enterWaitImg(event, context));
          break;
        case STATE_WAIT_LOCATION:
          waiting(enterWaitLocation(event, context));
          break;
        case STATE_WAIT_LOCATION_DETAIL:
          waiting(enterWaitLocationDetail(event, context));
          break;
        case STATE_WAIT_DESC:
          waiting(enterWaitDesc(event, context));
          break;
        case STATE_WAIT_TAGS:
          waiting(enterWaitTags(event, context));
          break;
        default:
          waiting(enterNull(event, context));
      }

      waiting(conversation.updateContext(userid, context));
      // console.log('-- Saved context --');
      // console.log(context);
    }),
  };
};
