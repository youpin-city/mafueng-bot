const bodyParser = require('body-parser');
const config = require('config');
const express = require('express');
const xhub = require('express-x-hub');

const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ?
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

const API_URI = (process.env.API_URI) ?
  process.env.API_URI : config.get('apiUri');

const API_USERNAME = (process.env.API_USERNAME) ?
  process.env.API_USERNAME : config.get('apiUsername');

const API_PASSWORD = (process.env.API_PASSWORD) ?
  process.env.API_PASSWORD : config.get('apiPassword');

const API_USER_ID = (process.env.API_USER_ID) ?
  process.env.API_USER_ID : config.get('apiUserId');

// eslint-disable-next-line max-len
if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && API_URI && API_USERNAME && API_PASSWORD && API_USER_ID)) {
  console.error('Missing config values');
  process.exit(1);
}


// Setup app
const app = express();

app.set('port', (process.env.PORT || 5200));
// Must be called before bodyParser
app.use(xhub({ algorithm: 'sha1', secret: APP_SECRET }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use('/static', express.static('public'));


// Messenger API utils
const m = require('./messenger.js')(PAGE_ACCESS_TOKEN);

// Conversation context
const conversation = require('./conversation.js')(config.get('sessionMaxLength'));

// Youpin API utils
const ApiLib = require('./youpin-api.js');

// Chula bot
let mafueng = require('./chula.js');
new ApiLib(API_URI, API_USERNAME, API_PASSWORD).then((api) => {
  mafueng = mafueng(m, api, conversation, API_USER_ID);
}).catch(err => {
  console.log(err);
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

// Index route
app.get('/', (req, res) => {
  res.send('มะเฟืองพร้อมให้บริการละค่ะ');
});


// Webhook verification
app.get('/webhook/', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === config.get('validationToken')) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});


// Handle messages
app.post('/webhook/', (req, res) => {
  // Verify signature
  if (req.isXHub) {
    if (req.isXHubValid()) {
      res.send('Verified!\n');
    }
  } else {
    res.send('Failed to verify!\n');
    res.sendStatus(401);
    return;
  }

  const data = req.body;
  if (data.object === 'page') {
    data.entry.forEach((pageEntry) => {
      pageEntry.messaging.forEach((msgEvent) => {
        if (msgEvent.message || msgEvent.postback) {
          mafueng.onMessaged(msgEvent);
        } else {
          console.log(`Webhook received unhandled messaging event: ${msgEvent}`);
        }
      });
    });
  }
});


// Notification hook verification
app.get('/notifhook/', (req, res) => {
  if (req.query['NOTIFICATION_TOKEN'] === config.get('notificationToken')) {
    res.send('Notification token is correct!');
  } else {
    res.sendStatus(403);
  }
});


// Handle notification messages
app.post('/notifhook/', (req, res) => {
  // Verify with notification that is set on both side.
  if (req.query['NOTIFICATION_TOKEN'] !== config.get('notificationToken')) {
    res.send('Incorrect notification token!');
    res.sendStatus(401);
    return;
  }
  const data = req.body;
  const userId = data.id;
  const message = data.message;
  if (!userId || !message) {
    res.send('userId and message must not be empty.');
    res.sendStatus(400);
    return;
  }
  m.sendText(userId, message);
  console.log(`Notified user id ${userId} with message - ${message}`);
  res.send(`Successfully notifying user id ${userId}`);
});

app.listen(app.get('port'), () => {
  console.log(`Node app is running on port ${app.get('port')}`);
});
