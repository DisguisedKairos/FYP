'use strict';

const { answer } = require('../models/assistant');

function messages(context) { return answer(context); }

module.exports = { messages };
