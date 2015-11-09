"use strict";

var chai = require('chai');
var sinon = require("sinon");
var should = chai.should();
var expect = chai.expect;
var cheerio = require('cheerio');
var Promise = require('bluebird');
var modulePath = "../../lib/asqOrderPlugin";
var fs = require("fs");
var _ = require('lodash');

describe("asqOrderPlugin.js", function(){
  
  before(function(){
    var then =  this.then = function(cb){
      return cb();
    };

    var create = this.create = sinon.stub().returns({
      then: then
    });

    this.tagName = "asq-order-q";

    this.asq = {
      registerHook: function(){},
      db: {
        model: function(){
          return {
            create: create
          }
        }
      }
    }

    //load html fixtures
    this.basicHtml = fs.readFileSync(require.resolve('./fixtures/basic.html'), 'utf-8');
    this.stemHtml = fs.readFileSync(require.resolve('./fixtures/stem.html'), 'utf-8');
    this.attrHtml = fs.readFileSync(require.resolve('./fixtures/attr.html'), 'utf-8');
    
    this.asqOrderPlugin = require(modulePath);
  });

  describe("parseHtml", function(){

    before(function(){
     sinon.stub(this.asqOrderPlugin.prototype, "processEl").returns("res");
    });

    beforeEach(function(){
      this.asqOrder = new this.asqOrderPlugin(this.asq);
      this.asqOrderPlugin.prototype.processEl.reset();
      this.create.reset();
    });

    after(function(){
     this.asqOrderPlugin.prototype.processEl.restore();
    });

    it("should call processEl() for all asq-order-q elements", function(done){
      var options = {
        html: this.basicHtml
      }
      this.asqOrder.parseHtml(options)
      .then(function(){
        this.asqOrder.processEl.calledTwice.should.equal(true);
        done();
      }.bind(this))
      .catch(function(err){
        done(err);
      });
    });

    it("should call `model().create()` to persist parsed exercise in the db", function(done){
      var options = {
        html: this.basicHtml
      }
      this.asqOrder.parseHtml(options)
      .then(function(result){
        this.create.calledOnce.should.equal(true);
        this.create.calledWith(["res", "res"]).should.equal(true);
        done();
      }.bind(this))
      .catch(function(err){
        done(err);
      });
    });

    it("should resolve with the file's html", function(done){
      var options = {
        html: this.basicHtml
      }
      this.asqOrder.parseHtml(options)
      .then(function(result){
        expect(typeof result.html).to.equal('string');
        done();
      }.bind(this))
      .catch(function(err){
        done(err);
      });
    });

  });

  describe("processEl", function(){

    before(function(){
    });

    beforeEach(function(){
      this.asqOrder = new this.asqOrderPlugin(this.asq);
    });

    after(function(){
    });

    it("should assign a uid to the exercise if there's not one", function(){
      var $ = cheerio.load(this.basicHtml,  {
        decodeEntities: false,
        lowerCaseAttributeNames:false,
        lowerCaseTags:false,
        recognizeSelfClosing: true
      });
      
      //this doesn't have an id
      var el = $("#no-uid")[0];
      this.asqOrder.processEl($, el);
      $(el).attr('uid').should.exist;
      $(el).attr('uid').should.not.equal("a-uid");

      //this already has one
      el = $("#uid")[0];
      this.asqOrder.processEl($, el);
      $(el).attr('uid').should.exist;
      $(el).attr('uid').should.equal("a-uid");
    });

    it("should find the stem if it exists", function(){
      var $ = cheerio.load(this.stemHtml,  {
        decodeEntities: false,
        lowerCaseAttributeNames:false,
        lowerCaseTags:false,
        recognizeSelfClosing: true
      });
      var el = $(this.tagName)[0];
      var elWithHtmlInStem = $(this.tagName)[1];
      var elWithoutStem = $(this.tagName)[2];

      var result = this.asqOrder.processEl($, el);
      expect(result.data.stem).to.equal("This is a stem");

      var result = this.asqOrder.processEl($, elWithHtmlInStem);
      expect(result.data.stem).to.equal("This is a stem <em>with some HTML</em>");


      var result = this.asqOrder.processEl($, elWithoutStem);
      expect(result.data.stem).to.equal("");
    });

    it("should get metadata correctly", function(){
      var $ = cheerio.load(this.attrHtml,  {
        decodeEntities: false,
        lowerCaseAttributeNames:false,
        lowerCaseTags:false,
        recognizeSelfClosing: true
      });

      var correctItems = ['ready','attached','created','detached'];

      var elWithSortable = $(this.tagName)[0];
      var elWithoutSortable = $(this.tagName)[1];
      var elWithAttrForSorted = $(this.tagName)[2];
      var elWithoutAttrForSorted = $(this.tagName)[3];


      var result = this.asqOrder.processEl($, elWithSortable);
      expect(_.isEqual(result.data.items, correctItems)).to.equal(true);

      var result = this.asqOrder.processEl($, elWithoutSortable);
      expect(_.isEqual(result.data.items, correctItems)).to.equal(true);

      var result = this.asqOrder.processEl($, elWithAttrForSorted);
      expect(_.isEqual(result.data.items, correctItems)).to.equal(true);

      var result = this.asqOrder.processEl($, elWithoutAttrForSorted);
      expect(_.isEqual(result.data.items, correctItems)).to.equal(true);

    });

  });

});
