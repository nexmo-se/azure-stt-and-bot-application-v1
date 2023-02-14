'use strict'

//-------------

require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser')
const app = express();
const expressWs = require('express-ws')(app);
const Vonage = require('@vonage/server-sdk');
const { Readable } = require('stream');

//--- HTTP client ---

const webHookRequest = require('request');

const reqHeaders = {
  'Content-Type': 'application/json',
  'Accept': 'application/json'
};

//------ for trade show external parties self started demos ------

const maxCallDuration = 180000; // 3 min
const maxCallsPerDay = 6;
// const ttsCustom1Duration = 15000; // 15 sec, approximate TTS duration + margin

const whiteListedNumbers = ['12995550101', '12995550202'];

const limitCalls = (process.env.LIMITCALLS === "true") || false;  // set to true for self-serve demos 

//------------- for demo with VIDS --------------

const vids = (process.env.VIDS === "true") || false;  // set to true when app is used by VIDS

let pusher;
let pchannel;
let pevent;

if (vids) {

  const Pusher = require("pusher");
  const pusher_id = process.env.PUSHER_ID;
  const pusher_key = process.env.PUSHER_KEY;
  const pusher_secret = process.env.PUSHER_SECRET;

  // Create an instance
  pusher = new Pusher({
      appId: pusher_id,
      key: pusher_key,
      secret: pusher_secret,
      useTLS: true, // optional, defaults to false
      cluster: "us3"
  });

  // name for channnel
  pchannel = "msapchannel";
  // event name, more event names may be created ...
  pevent = "msapevent";

};

const transferDelayToAgent = process.env.TRANSFER_DELAY_TO_AGENT; // in seconds

//---- CORS policy - Update this section as needed ----

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "OPTIONS,GET,POST,PUT,DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");
  next();
});

//-------

app.use(bodyParser.json());

//-------

let router = express.Router();
router.get('/', express.static('app'));
app.use('/app',router);

//------

const servicePhoneNumber = process.env.SERVICE_PHONE_NUMBER;

//-------------

const vonage = new Vonage({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
  applicationId: process.env.APP_ID,
  privateKey: './.private.key'
});

//------------

// Server hosting the connector for STT/ASR
const asrServer = process.env.ASR_SERVER;

//-------------

// Language locale

const languageCode = process.env.LANGUAGE_CODE || 'en-US';
const vapiTtsStyle = process.env.VAPI_TTS_STYLE || 11; // see https://developer.nexmo.com/voice/voice-api/guides/text-to-speech
const greetingText = process.env.GREETING_TEXT || "We are connecting your call, please wait.";

// const languageCode = process.env.LANGUAGE_CODE || 'fr-FR';
// const vapiTtsStyle = process.env.VAPI_TTS_STYLE || 6; // see https://developer.nexmo.com/voice/voice-api/guides/text-to-speech
// const greetingText = process.env.GREETING_TEXT || "Nous connectons votre appel, veuillez patienter.";

//-----------

console.log("Service phone number:", servicePhoneNumber);

//==========================================================

function reqCallback(error, response, body) {
    if (body != "Ok") {  
      console.log("HTTP request call status:", body);
    };  
}
 
//--- test making calls from a local request
app.get('/makecall', (req, res) => {

  res.status(200).send('Ok');

  const hostName = `${req.hostname}`;

  let callInfo;
  let reqOptions;

  callInfo = {
    'type': 'phone',
    'number': '14087726269', // enter here the actual number to call for tests
    'x_param_1': 'foo1',
    'x_param_2': 'foo2'
  };

  console.log("callInfo:", JSON.stringify(callInfo));

  reqOptions = {
    url: 'https://' + hostName + '/placecall',
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(callInfo)
  };

  webHookRequest(reqOptions, reqCallback);

});

//-----------------

app.post('/placecall', async(req, res) => {

  res.status(200).send('Ok');

  const hostName = `${req.hostname}`;
  const numberToCall = req.body.number;

  let xCustomFields = [];
  let customQueryParams = '';

  for (const [key, value] of Object.entries(req.body)) {
    console.log(`${key}: ${value}`);
    if (`${key}`.substring(0, 2) == 'x_') {
      xCustomFields.push(`${key}=${value}`);
    }
  }

  if (xCustomFields.length != 0) {
    customQueryParams = "&" + xCustomFields.join("&");
  };

  console.log('>>> custom query parameters in placecall:', customQueryParams);

  vonage.calls.create({
    to: [{
      type: 'phone',
      number: numberToCall
    }],
    from: {
     type: 'phone',
     number: servicePhoneNumber
    },
    answer_url: ['https://' + hostName + '/answer?language_code=' + languageCode + customQueryParams],
    answer_method: 'GET',
    event_url: ['https://' + hostName + '/event?language_code=' + languageCode + customQueryParams],
    event_method: 'POST'
    }, (err, res) => {
    if(err) {
      console.error(">>> outgoing call error:", err);
      console.error(err.body.title);
      console.error(err.body.invalid_parameters);
    } else {
      console.log(">>> outgoing call status:", res);
    }
  });

});

//-----------------

app.post('/msacall', async(req, res) => {

  res.status(200).send('Ok');

  const hostName = `${req.hostname}`;
  const customerNumber = req.body.customerNumber;
  const agentNumber = req.body.agentNumber;
  const conferenceName = req.body.conferenceName;
  const languageCode = req.body.languageCode;
  const msaServices = req.body.msaServices;

  let xCustomFields = [];
  let customQueryParams = '';

  for (const [key, value] of Object.entries(req.body)) {
    console.log(`${key}: ${value}`);
    if (`${key}`.substring(0, 2) == 'x_') {
      xCustomFields.push(`${key}=${value}`);
    }
  }

  if (xCustomFields.length != 0) {
    customQueryParams = "&" + xCustomFields.join("&");
  };

  console.log('>>> custom query parameters in msacall:', customQueryParams);

  vonage.calls.create({
    to: [{
      type: 'phone',
      number: customerNumber
    }],
    from: {
     type: 'phone',
     number: servicePhoneNumber
    },
    answer_url: ['https://' + hostName + '/answer?language_code=' + languageCode + '&conference_name=' + conferenceName + '&msa_services=' + msaServices + '&agent_number=' + agentNumber + customQueryParams],
    answer_method: 'GET',
    event_url: ['https://' + hostName + '/event?language_code=' + languageCode + '&conference_name=' + conferenceName + '&msa_services=' + msaServices + '&agent_number=' + agentNumber + customQueryParams],
    event_method: 'POST'
    }, (err, res) => {
    if(err) {
      console.error(">>> outgoing call error:", err);
      console.error(err.body.title);
      console.error(err.body.invalid_parameters);
    } else {
      console.log(">>> outgoing call status:", res);
    }
  });

});

//-----------------

app.get('/answer', (req, res) => {

    const hostName = `${req.hostname}`;

    // const languageCode = req.query.language_code; <<< TO DO

    let conferenceNameSuffix = "";
    let agentNumber = "";


    if (req.query.hasOwnProperty('conference_name')) {
      conferenceNameSuffix = req.query.conference_name;
    } else {
      conferenceNameSuffix = req.query.uuid;
    };

    // if (req.query.hasOwnProperty('agent_number')) {
    //   agentNumber = req.query.agent_number;
    // }; 
    
    let nccoResponse = [
        {
          "action":"talk",
          "language": languageCode, // TO DO - set language code from request query parameter
          "text": greetingText, // TO DO - set greeting text corresponding to language code
          "style": vapiTtsStyle // TO DO - set preferred VAPI TTS style for the language code
        },
        {
          "action": "conversation",
          "name": "conference_" + conferenceNameSuffix,
          "startOnEnter": true,
          "endOnExit": true // necessary to end any other call legs connected to this conference (WebSocket, PSTN, SIP, ...)
        }
      ];

    res.status(200).json(nccoResponse);
});


//-------

app.post('/event', (req, res) => {

  res.status(200).json({});

  const hostName = `${req.hostname}`;
  const uuid = req.body.uuid;

    // const languageCode = req.query.language_code; <<< TO DO

  let agentNumber = "";
  if (req.query.hasOwnProperty('agent_number')) {
      agentNumber = req.query.agent_number;
  }; 

  let xCustomFields = [];
  let customQueryParams = '';

  for (const queryParameter in req.query){    
    if (`${queryParameter}`.substring(0, 2) == 'x_') {
      xCustomFields.push(`${queryParameter}=${req.query[`${queryParameter}`]}`);
    }
  }

  // console.log('in event webhook callback, xCustomFields:', xCustomFields);

  if (xCustomFields.length != 0) {
    customQueryParams = "&" + xCustomFields.join("&");
  };

  // console.log('in event webhook callback, customQueryParams:', customQueryParams);

  //--

  if (req.body.type == 'transfer'){

    let conferenceNameSuffix;

    if (req.query.hasOwnProperty('conference_name')) {
      conferenceNameSuffix = req.query.conference_name;
    } else {
      conferenceNameSuffix = req.body.uuid;
    };


    console.log("In /event - type == transfer");
    console.log("conferenceNameSuffix:", conferenceNameSuffix);

    // TO DO - set language code from request query parameter
    const wsUri = 'wss://' + asrServer + '/socket?original_uuid=' + uuid + '&language_code=' + languageCode + '&webhook_url=https://' + hostName + '/asr' + '&conference_name=' + conferenceNameSuffix + customQueryParams; 
    console.log('>>> websocket URI:', wsUri);

    // create corresponding websocket
    vonage.calls.create({
       to: [{
         type: 'websocket',
         uri: wsUri,
         'content-type': 'audio/l16;rate=16000',
         headers: {}
        }],
       from: {
         type: 'phone',
         number: 19999999999 // cannot use a longer than 15-digit string (e.g. not call_uuid)
       },
       answer_url: ['https://' + hostName + '/ws_answer?original_uuid=' + uuid + '&language_code=' + languageCode + '&conference_name=' + conferenceNameSuffix + '&agent_number=' + agentNumber + customQueryParams],
       event_url: ['https://' + hostName + '/ws_event?original_uuid=' + uuid + '&language_code=' + languageCode + '&conference_name=' + conferenceNameSuffix + '&agent_number=' + agentNumber + customQueryParams]
      }, (err, res) => {
       if(err) {
                console.error(">>> websocket create error:", err);
                console.error(err.body.title);
                console.error(err.body.invalid_parameters);
                }
       else { console.log(">>> websocket create status:", res); }
      });
  
  };

});

//-----------------------------------------

app.get('/ws_answer', (req, res) => {

  const originalUuid = req.query.original_uuid;
  const conferenceNameSuffix = req.query.conference_name;
  
  let nccoResponse = [
    {
      "action": "conversation", 
      "canHear": [originalUuid], // listen only to customer's call leg voice, not the agent call leg for example
      "name": "conference_" + conferenceNameSuffix  // to handle multiple separate conf/voice calls
    }
  ];

  console.log ('>>> nccoResponse:\n', nccoResponse);

  res.status(200).json(nccoResponse);
});

//-----------------------------------------

app.post('/ws_event', (req, res) => {

  res.status(200).json({});

  if (req.body.status == "answered") {
    
    const wsUuid = req.body.uuid;
    console.log("Websocket uuid:", wsUuid);

    const agentNumber = req.query.agent_number;
    
    app.set('vapiUuidToWsUuidAndAgentNumber_' + req.query.original_uuid, wsUuid + '/' + agentNumber);
  
  };

  if (req.body.status == "completed") {
    
    const originalUuid = req.query.original_uuid;
    
    app.set('vapiUuidToWsUuidAndAgentNumber_' + req.query.original_uuid, null);
  
  };

});

//---------

app.post('/rtc', (req, res) => {

  res.status(200).json({});

});

//---------

app.post('/asr', (req, res) => {

  res.status(200).send('Ok');

  const hostName = `${req.hostname}`;

  if (req.body.hasOwnProperty('msaConversationId')) {
    // store corresponding Voice API original call uuid, and conference name suffix
    app.set('msaIdToVapiUuidAndConfName_' + req.body.msaConversationId, req.body.vapiUuid + '/' + req.body.confName );
  };

  if (vids) {  // post back to VIDS

    let pdata = req.body;
    pdata["timestamp"] = Date.now();
    console.log('>>> posted info:', pdata)

    pusher.trigger(pchannel, pevent, pdata);

  } else {

    const timeNow = Date.now();
    console.log('>>>', timeNow.toString());
    console.log(req.body);

  };  

});

//---------

app.post('/msahandover', (req, res) => {

  console.log('>>> msa hand over');
  // console.log(req.body);

  const hostName = `${req.hostname}`;

  const msaConversationId = req.body.activity.conversation.id;

  const vapiUuidAndConfName = app.get('msaIdToVapiUuidAndConfName_' + msaConversationId);

  const confName = vapiUuidAndConfName.split('/')[1];
  console.log('>>> conference name suffix:', confName);

  const vapiUuid = vapiUuidAndConfName.split('/')[0];
  const wsUuidAndAgentNumber = app.get('vapiUuidToWsUuidAndAgentNumber_' + vapiUuid);

  const wsUuid = wsUuidAndAgentNumber.split('/')[0];
  const agentNumber = wsUuidAndAgentNumber.split('/')[1];

  console.log('>>> uuid of WebSocket to connector:', wsUuid);
  console.log('>>> agent number:', agentNumber);

  //-- call agent and end WebSocket - with some delay

  setTimeout( () => {

    //-- call agent --

    vonage.calls.create({
      to: [{
        type: 'phone',
        number: agentNumber
      }],
      from: {
       type: 'phone',
       number: servicePhoneNumber
      },
      answer_url: ['https://' + hostName + '/answer_agent?conference_name=' + confName],
      answer_method: 'GET',
      event_url: ['https://' + hostName + '/event_agent?conference_name=' + confName],
      event_method: 'POST'
      }, (err, res) => {
      if(err) {
        console.error(">>> outgoing call to agent error:", err);
        console.error(err.body.title);
        console.error(err.body.invalid_parameters);
      } else {
        console.log(">>> outgoing call to agent status:", res);
      }
    });

    //-- end WebSocket

    vonage.calls.update(wsUuid,
      { action: 'hangup' }, (err, res) => {
        if (err) { console.error('\nTeminating WebSocket leg', wsUuid, 'error:', err, 'err.invalid_parameters', err.body.invalid_parameters); }
        else { console.log('\nTerminated WebSocket leg', wsUuid); }
    })

    //--

    console.log('>>> zone 1');

    app.set('msaIdToConfName_' + msaConversationId, null );
    app.set('vapiUuidToWsUuidAndAgentNumber_' + vapiUuid, null);


    //--
    
    res.status(200).send('Ok');

  }, transferDelayToAgent * 1000);


});

//---------

app.get('/msahandover', (req, res) => {

  res.status(200).send('Ok');

});

//-----------------------------------------

app.get('/answer_agent', (req, res) => {

  const conferenceNameSuffix = req.query.conference_name;
  
  let nccoResponse = [
    {
      "action": "conversation", 
      "name": "conference_" + conferenceNameSuffix  // to handle multiple separate conf/voice calls
    }
  ];

  console.log ('>>> nccoResponse:\n', nccoResponse);

  res.status(200).json(nccoResponse);
});

//-----------------------------------------

app.post('/event_agent', (req, res) => {

  res.status(200).send('Ok');

});


//=========================================

const port = process.env.PORT || 8000;

app.listen(port, () => console.log(`Client application to Azure STT listening on port ${port}!`));

//------------
