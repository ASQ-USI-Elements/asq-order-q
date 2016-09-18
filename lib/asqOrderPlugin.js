var ASQPlugin = require('asq-plugin');
var ObjectId = require("bson-objectid");
var Promise = require('bluebird');
var coroutine = Promise.coroutine;
var cheerio = require('cheerio');
var assert = require('assert');
var _ = require('lodash');


//http://www.w3.org/html/wg/drafts/html/master/infrastructure.html#boolean-attributes
function getBooleanValOfBooleanAttr(attrName, attrValue){
  if(attrValue === '' || attrValue === attrName){
    return true;
  }
  return false;
}

module.exports = ASQPlugin.extend({
  tagName : 'asq-order-q',

  hooks:{
    "parse_html"          : "parseHtml",
    "answer_submission"   : "answerSubmission",
    "presenter_connected" : "presenterConnected",
    "viewer_connected"    : "viewerConnected"
  },

  parseHtml: function(options){
    var $ = cheerio.load(options.html,  {
      decodeEntities: false,
      lowerCaseAttributeNames:false,
      lowerCaseTags:false,
      recognizeSelfClosing: true
    });
    var questions = [];

    $(this.tagName).each(function(idx, el){
      questions.push(this.processEl($, el));
    }.bind(this));
    options.html = $.root().html();

    //return Promise that resolves with the (maybe modified) html
    return this.asq.db.model("Question").create(questions)
    .then(function(){
      return Promise.resolve(options);
    });
    
  },

  answerSubmission: coroutine(function *answerSubmissionGen (answer){
    // make sure answer question exists
    var questionUid = answer.questionUid
    var question = yield this.asq.db.model("Question").findById(questionUid).exec(); 
    assert(question,
      'Could not find question with id' + questionUid + 'in the database');

    //make sure it's an answer for a multi-choice question
    if(question.type !=='asq-order-q') {
      return answer;
    }

    assert(_.isArray(answer.submission),
      'Invalid answer format, answer.submission should be an array.');

    //persist
    yield this.asq.db.model("Answer").create({
      exercise   : answer.exercise_id,
      question   : questionUid,
      answeree   : answer.answeree,
      session    : answer.session,
      type       : question.type,
      submitDate : Date.now(),
      submission : answer.submission,
      confidence : answer.confidence
    });

    yield this.calculateProgress(answer.session, ObjectId(questionUid));

    //this will be the argument to the next hook
    return answer;
  }),

  calculateProgress: coroutine(function *calculateProgressGen(session_id, question_id){
    var criteria = {session: session_id, question:question_id};
    var pipeline = [
      { $match: {
          session: session_id,
          question : question_id
        }
      },
      {$sort:{"submitDate":-1}},
      { $group:{
          "_id":"$answeree",
          "submitDate":{$first:"$submitDate"},
          "submission": {$first:"$submission"}
        }
      }
    ]

    var submissions = yield this.asq.db.model('Answer').aggregate(pipeline).exec();


    var event = {
      questionType: this.tagName,
      uid: question_id,
      type: 'progress',
      question: {
        uid: question_id.toString(),
        submissions: submissions,
      }
    }

    this.asq.socket.emitToRoles('asq:question_type', event, session_id.toString(), 'ctrl')

  }),

  processEl: function($, el){
    // TODO: fix this
    var $el = $(el);

    //make sure question has a unique id
    var uid = $el.attr('uid');
    if(uid == undefined || uid.trim() == ''){
      $el.attr('uid', uid = ObjectId().toString() );
    } 

    //get stem
    var stem = $el.find('asq-stem');
    if(stem.length){
      stem = stem.eq(0).html();
    }else{
      stem = '';
    }

    var sortable = $el.attr('sortable') ? $el.attr('sortable') : '*';
    var attrForSorted = $el.attr('attr-for-sorted') ? $el.attr('attr-for-sorted') : 'name';


    var items = $el.find(sortable).toArray();

    itemNames = items.map(function(item) {
      return $(item).attr(attrForSorted);
    });

    return {
      _id : uid,
      type: this.tagName,
      data: {
        html: $.html($el),
        stem: stem,
        items: itemNames
      }
    }
  },


  restorePresenterForSession: coroutine(function *restorePresenterForSessionGen(session_id, presentation_id){
    var questions = yield this.asq.db.getPresentationQuestionsByType(presentation_id, this.tagName);
    var questionIds = questions.map(function(q){
      return q._id;
    });

    var pipeline = [
      { $match: {
          session: session_id,
          "question" : {$in : questionIds}
        }
      },
      { $sort:{"submitDate": -1}},
      { $group:{
          "_id":{
            "answeree" : "$answeree",
            "question" : "$question"
          },
          "submitDate":{$first:"$submitDate"},
          "submission": {$first:"$submission"},
        }
      },
      { $group:{
          "_id": {
            "question" : "$_id.question",
          },
          "submissions": {$push: {
            "_id" : "$_id.answeree" ,
            "submitDate": "$submitDate", 
            "submission": "$submission" 
          }}
        }
      },
      { $project : { 
          "_id": 0,
          "uid" : "$_id.question",
          "submissions" : 1
        } 
      }
    ]

    var answers = yield this.asq.db.model('Answer').aggregate(pipeline).exec();

    return answers;        
  }),


  presenterConnected: coroutine(function *presenterConnectedGen (info){
    if(! info.session_id) return info;

    var questionsWithScores = yield this.restorePresenterForSession(info.session_id, info.presentation_id);

    var event = {
      questionType: this.tagName,
      type: 'restorePresenter',
      questions: questionsWithScores,
    }

    this.asq.socket.emit('asq:question_type', event, info.socketId)

    //this will be the argument to the next hook
    return info;
  }),

  
  restoreViewerForSession: coroutine(function *restoreViewerForSessionGen(session_id, presentation_id, whitelistId){
    var questions = yield this.asq.db.getPresentationQuestionsByType(presentation_id, this.tagName);
    var questionIds = questions.map(function(q){
      return q._id;
    });

    var pipeline = [
      { $match: {
          "session": session_id,
          "answeree" : whitelistId,
          "question" : {$in : questionIds}
        }
      },
      { $sort:{"submitDate": -1} },
      { $group:{
          "_id": "$question",
          "orders": {$first:"$submission"},
        }
      },
      { $project:{
          "_id": 0,
          "uid" : "$_id",
          "orders": 1,
        }
      }
    ]
    var questionsWithAnswers = yield this.asq.db.model('Answer').aggregate(pipeline).exec();

    return questionsWithAnswers;    
  }),
  
  viewerConnected: coroutine(function *viewerConnectedGen (info){
    if(! info.session_id) return info;

    var questionsWithAnswers = yield this.restoreViewerForSession(info.session_id, info.presentation_id, info.whitelistId);

    var event = {
      questionType: this.tagName,
      type: 'restoreViewer',
      questions: questionsWithAnswers
    }

    this.asq.socket.emit('asq:question_type', event, info.socketId)
    // this will be the argument to the next hook
    return info;
  }),


});