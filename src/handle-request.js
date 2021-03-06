'use strict';
const _ = require('lodash');

/**
 * Handles request and calls done when finished
 * @param {Object} app - Application object
 * @param {Object} request - Request JSON to be handled
 * @param {Function} handlers - Handlers to be called. Contains onStart, onEnd, actionFail
 * @param {Function} done - Callback to be called when request is handled. Callback is called with one argument - response JSON
 */
module.exports = (app, request, handlers, done) => {
    const appId = request.session.application.applicationId;
    const options = app.options;
    const intents = _.values(app.intents);

    // Application ids is specified and does not contain app id in request
    if(options && options.ids && options.ids.length > 0 && options.ids.indexOf(appId) === -1) {
        throw new Error('Application id is not valid');
    }

    if(request.session.new) {
        request.session.attributes = {
            previousIntent: '@start'
        };
    } else if(!request.session.attributes) {
        request.session.attributes = {};
    }

    const requestType = request.request.type;

    switch (requestType) {

        case 'LaunchRequest':
            callHandler(handlers.onStart, null, request.session.attributes, app, done);
            break;

        case 'IntentRequest':
            const intentName = request.request.intent.name;
            const intent = app.intents[request.request.intent.name];

            if(!intent) {
                throw new Error(`Unsupported intent: '${intentName}'`);
            }

            checkActionsAndHandle(intent, request.request.intent.slots, request.session.attributes, app, handlers, done)
            break;

        case 'SessionEndedRequest':
            callHandler(handlers.onEnd, null, request.session.attributes, app, done);
            break;

        default:
            throw new Error(`Unsupported request: '${requestType}'`)
    }

}

const callHandler = (handler, slots, attrs, app, done) => {
    
    // Transform slots into simple key:value schema
    slots = _.transform(slots, (result, value) => {
        result[value.name] = value.value;
    }, {});

    const optionsReady = (options) => {
        done(createResponse(options, slots, attrs, app));
    };

    // Handle intent synchronously if has < 3 arguments. 3rd is `done`
    if(handler.length < 3) {
        optionsReady(handler(slots, attrs));

    } else {
        handler(slots, attrs, optionsReady);
    }

    handler(attrs, slots);
};

/**
 * Checks for `actions` presence to help us with Alexa coznversation workflow configuration
 *
 *  1) no actions: just call the intent.handler method without any checks
 *  2) with actions: check if action for current intent transition is found
 *   a) action found: call its `if` function and if condition fails run `fail` function
 *   b) no action: call default `fail` function
 *
 * @param intent
 * @param slots
 * @param attrs
 * @param app
 * @param handlers
 * @param done
 */
const checkActionsAndHandle = (intent, slots, attrs, app, handlers, done) => {

    if (app.actions.length === 0) {
        // There are no actions. Just call handler on this intent
        attrs.previousIntent = intent.name;
        callHandler(intent.handler, slots, attrs, app, done);

    } else {
        // If there are some actions, try to validate current transition
        var action = _.find(app.actions, {from: attrs.previousIntent, to: intent.name});

        // Try to find action with wildcards if no action was found
        if(!action) {
            action = _.find(app.actions, {from: attrs.previousIntent, to: '*'});
        }
        if(!action) {
            action = _.find(app.actions, {from: '*', to: intent.name});
        }

        if (action) {

            // Action was found. Check if this transition is valid
            if (action.if ? action.if(slots, attrs) : true) {

                // Transition is valid. Remember intentName and handle intent
                attrs.previousIntent = intent.name;
                callHandler(intent.handler, slots, attrs, app, done);

            } else {
                // Transition is invalid. Call fail function
                if(action.fail) {
                    callHandler(action.fail, slots, attrs, app, done);
                } else {
                    callHandler(handlers.defaultActionFail, slots, attrs, app, done);
                }
            }

        } else {
            callHandler(handlers.defaultActionFail, slots, attrs, app, done);
        }
    }
};

const createResponse = (options, slots, attrs, app) => {
    // Convert text options to object
    if(typeof(options) === 'string') {
        options = {
            text: options
        };
    }

    // Create outputSpeech object for text or ssml
    const outputSpeech = createOutputSpeechObject(options.text, options.ssml)

    let responseObject = {
        version: app.options ? app.options.version : '0.0.1',
        sessionAttributes: options.attrs ? options.attrs : attrs,
        response: {
            outputSpeech: outputSpeech,
            shouldEndSession: options.end || false
        }
    };

    if(options.reprompt) {
        responseObject.response.reprompt = {
            outputSpeech: createOutputSpeechObject(options.reprompt, options.ssml)
        };

    }

    let card = createCardObject(options.card);
    if(card) {
        responseObject.response.card = card;
    }

    return responseObject;
};

/**
 * Creates output speech object used for text response or reprompt
 * @param {string} text - Text or Speech Synthesis Markup (see sendResponse docs)
 * @param {bool} ssml - Whether to use ssml
 * @returns {Object} outputSpeechObject in one of text or ssml formats
 */
const createOutputSpeechObject = (text, ssml) => {
    let outputSpeech = {};
    if(!ssml) {
        outputSpeech.type = 'PlainText';
        outputSpeech.text = text;
    } else {
        outputSpeech.type = 'SSML';
        outputSpeech.ssml = text;
    }
    return outputSpeech;
};

/**
 * Creates card object and wraps it with card type
 * @param {Object} card - Card object from responseData options
 * @returns {Object} card - Card object with type, title and content or undefined if card is not specified
 */
const createCardObject = (card) => {
    if (card) {
        return {
            type: 'Simple',
            title: card.title,
            content: card.content
        };
    }
};