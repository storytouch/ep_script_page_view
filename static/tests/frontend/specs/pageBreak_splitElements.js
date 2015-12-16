describe("ep_script_page_view - page break on split elements", function() {
  // shortcuts for helper functions
  var utils, splitElements;
  // context-dependent values/functions
  var linesBeforeTargetElement, buildTargetElement, lastLineText;

  before(function(){
    utils = ep_script_page_view_test_helper.utils;
    splitElements = ep_script_page_view_test_helper.splitElements;
  });

  beforeEach(function(cb){
    helper.newPad(function() {
      utils.cleanPad(function() {
        var generals      = utils.buildScriptWithGenerals("general", linesBeforeTargetElement);
        var targetElement = buildTargetElement();
        var script        = generals + targetElement;

        utils.createScriptWith(script, lastLineText, cb);
      });
    });
    this.timeout(60000);
  });

  context("when first line of page is a very long general", function() {
    var textAfterPageBreak;

    before(function() {
      // give enough space for first line of general to fit on first page
      linesBeforeTargetElement = GENERALS_PER_PAGE - 1;
      var line1 = utils.buildStringWithLength(60, "1") + ".";
      var line2 = utils.buildStringWithLength(60, "2") + ".";
      lastLineText = line1 + line2;
      textAfterPageBreak = line2;
      buildTargetElement = function() {
        return utils.general(lastLineText);
      };
    });

    it("splits general into two parts, one on each page", function(done) {
      splitElements.testPageBreakIsOn(textAfterPageBreak, done);
    });

    it("removes existing page breaks and recalculates new ones when user changes pad content", function(done) {
      var inner$ = helper.padInner$;

      // there should be a page break before we start testing
      var $splitElementsWithPageBreaks = inner$("div elementPageBreak");
      expect($splitElementsWithPageBreaks.length).to.be(1);

      // create another very long general before the last one, so pagination needs to be re-done
      var $threeLinesGeneral = inner$("div").last().prev();
      var line1 = utils.buildStringWithLength(60, "A") + ".";
      var line2 = utils.buildStringWithLength(60, "B") + ".";
      var line3 = utils.buildStringWithLength(60, "C") + ".";
      $threeLinesGeneral.sendkeys("{selectall}");
      $threeLinesGeneral.sendkeys(line1 + line2 + line3);

      // wait for edition to be processed and pagination to be complete
      helper.waitFor(function() {
        var $splitElementsWithPageBreaks = inner$("div elementPageBreak");
        var $firstPageBreak = $splitElementsWithPageBreaks.first();

        // page break was added to second line of first very long general
        return $firstPageBreak.text() === line2;
      }).done(function() {
        // now there should be only a single page break (on the first very long general)
        var $splitElementsWithPageBreaks = inner$("div elementPageBreak");
        expect($splitElementsWithPageBreaks.length).to.be(1);

        done();
      });
    });

    context("when user presses UNDO", function() {
      before(function() {
        // give enough space for a one-line-general + first line of a two-lines-general to fit on first page
        linesBeforeTargetElement = GENERALS_PER_PAGE - 2;
        buildTargetElement = function() {
          var generalToBeEdited = utils.general("I'm a general, edit me, please");
          var twoLinesGeneral = utils.general(lastLineText);
          return generalToBeEdited + twoLinesGeneral;
        };
      });

      it("disregard changes made by pagination and undoes last edition made by user", function(done) {
        var inner$ = helper.padInner$;

        // there should be a page break before we start testing
        var $splitElementsWithPageBreaks = inner$("div elementPageBreak");
        expect($splitElementsWithPageBreaks.length).to.be(1);

        // edit one element
        var $elementToBeEdited = inner$("div").last().prev();
        var originalText = $elementToBeEdited.text();
        $elementToBeEdited.sendkeys("{selectall}");
        $elementToBeEdited.sendkeys("Now I'm edited!");

        // first UNDO: should revert edition made on previous step
        utils.undo();
        var $elementToBeEdited = inner$("div").last().prev();
        expect($elementToBeEdited.text()).to.be(originalText);

        // second UNDO: should revert full script creation
        utils.undo();
        var padText = inner$("#innerdocbody").text();
        expect(padText).to.be("");

        done();
      })
    });
  });

  // context("when first line of page is a very long heading", function() {
  //   before(function() {
  //     linesBeforeTargetElement = GENERALS_PER_PAGE - 4;
  //     var line1 = utils.buildStringWithLength(61, "1");
  //     var line2 = utils.buildStringWithLength(61, "2");
  //     var line3 = utils.buildStringWithLength(61, "3");
  //     var line4 = utils.buildStringWithLength(61, "4");
  //     lastLineText = line1 + line2 + line3 + line4;
  //     buildTargetElement = function() {
  //       return utils.heading(lastLineText);
  //     };
  //   });

  //   it("does not split heading into two parts, one on each page", function(done) {
  //     var fullElementText = lastLineText;
  //     splitElements.testPageBreakIsOn(fullElementText, done);
  //   });
  // });
});

var ep_script_page_view_test_helper = ep_script_page_view_test_helper || {};
ep_script_page_view_test_helper.splitElements = {
  testPageBreakIsOn: function(textAfterPageBreak, done) {
    var inner$ = helper.padInner$;

    // verify there is one page break
    var $splitElementsWithPageBreaks = inner$("div elementPageBreak");
    expect($splitElementsWithPageBreaks.length).to.be(1);

    // verify page break is on targetElement
    var $firstPageBreak = $splitElementsWithPageBreaks.first();
    expect($firstPageBreak.text()).to.be(textAfterPageBreak);

    done();
  },
}
