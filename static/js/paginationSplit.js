var _ = require('ep_etherpad-lite/static/js/underscore');

var randomString         = require('ep_etherpad-lite/static/js/pad_utils').randomString;
var utils                = require('./utils');
var paginationPageNumber = require('./paginationPageNumber');
var paginationNonSplit   = require('./paginationNonSplit');
var scriptElementUtils   = require('ep_script_elements/static/js/utils');

var PAGE_BREAKS_ATTRIB                     = "splitPageBreak";
var PAGE_BREAKS_WITH_MORE_AND_CONTD_ATTRIB = "splitPageBreakWithMoreAndContd";

var FIRST_HALF_ATTRIB = "splitFirstHalf";
var SECOND_HALF_ATTRIB = "splitSecondHalf";

var ETHERPAD_AND_PAGE_BREAK_ATTRIBS = _.union(
  [
    // Etherpad basic line attributes
    'author', 'lmkr', 'insertorder', 'start',
    // page number attrib
    paginationPageNumber.PAGE_NUMBER_ATTRIB,
    // attributes used to mark a line as split
    PAGE_BREAKS_ATTRIB, PAGE_BREAKS_WITH_MORE_AND_CONTD_ATTRIB, FIRST_HALF_ATTRIB, SECOND_HALF_ATTRIB
  ],
  // attributes used to mark a line as non-split
  paginationNonSplit.PAGE_BREAK_ATTRIBS
);

var PAGE_BREAK_TAG = "splitPageBreak";
exports.PAGE_BREAK_TAG = PAGE_BREAK_TAG;
utils.registerPageBreakTag(PAGE_BREAK_TAG);

var FIRST_HALF_TAG                     = "split_first_half";
var FIRST_HALF_WITH_MORE_AND_CONTD_TAG = "split_with_more_and_contd_first_half";
var SECOND_HALF_TAG                    = "split_second_half";
exports.SECOND_HALF_TAG = SECOND_HALF_TAG;

var DO_NOT_COLLECT = 'ignore_pagination_attribs';

var SENTENCE_MARKER_AND_WHITESPACE_REGEX = /^(.*[.?!;]\s+)[^.?!;]*$/;
var WHITESPACE_REGEX                     = /^(.*\s+)[^\s]*$/;

var MERGED_LINE = "merged";
exports.MERGED_LINE = MERGED_LINE;

// number of minimum lines each element needs before a page break so it can be split in two parts
// (default is 1)
// exception: if line is a dialogue or parenthetical, and previous line is a character,
// it needs 2 lines before page break, and not only 1. But this is handled on
// getMinimumLinesBeforePageBreakFor, not here
var MINIMUM_LINES_BEFORE_PAGE_BREAK = {
  action: 2,
};

// number of minimum lines each element needs after a page break so it can be split in two parts
// (default is 1)
var MINIMUM_LINES_AFTER_PAGE_BREAK = {
  action: 2,
  transition: 2,
  dialogue: 2,
  parenthetical: 2,
};

// number of chars each element can hold in a single line
// (default is 61)
var CHARS_PER_LINE = {
  character: 38,
  dialogue: 35,
  transition: 16,
  parenthetical: 25,
};

// indicates if element can be split between two pages
var CAN_BE_SPLIT = {
  general: true,
  action: true,
  transition: true,
  dialogue: true,
  parenthetical: true,
  heading: false,
  character: false,
  shot: false,
};

// indicates if element should have MORE/CONT'D when split between pages
// (default is false)
var HAVE_MORE_AND_CONTD = {
  dialogue: true,
  parenthetical: true,
}

exports.getSplitInfo = function($helperLine, $originalLine, lineNumberShift, availableHeightOnPageWithoutMargins, originalCaretPosition, attributeManager, rep) {
  var lineInfo = getLineInfo($helperLine, $originalLine, originalCaretPosition, attributeManager, rep);

  if (canSplit(lineInfo)) {
    var linesAvailableBeforePageBreak = getNumberOfInnerLinesThatFitOnPage($helperLine, availableHeightOnPageWithoutMargins);
    var minimumLinesBeforePageBreak = getMinimumLinesBeforePageBreakFor(lineInfo);

    // only calculate the position where element should be split if there is enough space to do that
    if (linesAvailableBeforePageBreak >= minimumLinesBeforePageBreak) {
      var splitPosition = calculateSplitPosition(linesAvailableBeforePageBreak, lineInfo, lineNumberShift);
      if (splitPosition) {
        // ok, can split element
        return splitPosition;
      }
    }
  }
}

// Put together information about the line. Use the returned value to move around line information
// through the functions of this file
var getLineInfo = function($helperLine, $originalLine, originalCaretPosition, attributeManager, rep) {
  var lineIdBeforeRepagination     = $originalLine.attr("id");
  var lineNumberBeforeRepagination = rep.lines.indexOfKey(lineIdBeforeRepagination);
  var lineHasMarker                = lineHasMarkerExcludingSplitLineMarkers(lineNumberBeforeRepagination, attributeManager);
  // If line has no marker, it means it lost its "*", so we need to decrement column number
  // (assuming caret was on a split line before repagination started)
  // WARNING: this logic to calculate caret column might need a revision if we use caretAtColumn
  // for something else other than checking if caret was originally on split position
  // (see calculateSplitPosition())
  var caretAtColumn = lineHasMarker ? originalCaretPosition[1] : originalCaretPosition[1] - 1;
  var caretIsAtLine = (originalCaretPosition[0] === lineNumberBeforeRepagination);

  return {
    // properties always needed
    lineNumberBeforeRepagination: lineNumberBeforeRepagination,
    lineText: $helperLine.text(),
    lineHasMarker: lineHasMarker,
    typeOfLine: utils.typeOf($helperLine),
    $originalLine: $originalLine,
    caretIsAtLine: caretIsAtLine,
    caretAtColumn: caretAtColumn,
    // properties needed only on some scenarios. Use functions instead of calculated property to
    // postpone calculation until (and if) needed
    typeOfPreviousLine: function() {
      return utils.typeOf($originalLine.prev());
    },
    findCharacterName: function() {
      return utils.findCharacterNameOf($originalLine);
    },
  };
}

// based on code from AttributeManager.js (function removeAttributeOnLine)
var lineHasMarkerExcludingSplitLineMarkers = function(lineNumber, attributeManager) {
  var lineAttributes = attributeManager.getAttributesOnLine(lineNumber);
  var countAttribsWithMarker = _.chain(lineAttributes).
    filter(function(a){return !!a[1];}). // remove absent attributes
    map(function(a){return a[0];}). // get only attribute names
    difference(ETHERPAD_AND_PAGE_BREAK_ATTRIBS). // exclude Etherpad basic attributes + page break markers
    size().value(); // get number of attributes

  return countAttribsWithMarker > 0;
}

var canSplit = function(lineInfo) {
  var typeOfLine = lineInfo.typeOfLine;
  var canBeSplit = CAN_BE_SPLIT[typeOfLine];
  return canBeSplit;
}

var getNumberOfInnerLinesThatFitOnPage = function($helperLine, availableHeightForInnerLines) {
  var singleInnerLineHeight = utils.getRegularLineHeight();
  var numberOfLinesThatFit  = parseInt(availableHeightForInnerLines/singleInnerLineHeight);

  return numberOfLinesThatFit;
}

var getMinimumLinesBeforePageBreakFor = function(lineInfo) {
  var typeOfLine = lineInfo.typeOfLine;
  var minimumLines = MINIMUM_LINES_BEFORE_PAGE_BREAK[typeOfLine] || 1;

  // exception: if current line is a dialogue or parenthetical, and previous line is a character,
  // it needs 2 lines before page break, and not only 1
  if (typeOfLine === "dialogue" || typeOfLine === "parenthetical") {
    var typeOfPreviousLine = lineInfo.typeOfPreviousLine();
    if (typeOfPreviousLine === "character") {
      minimumLines = 2;
    }
  }

  return minimumLines;
}

var getMinimumLinesAfterPageBreakFor = function(lineInfo) {
  var typeOfLine = lineInfo.typeOfLine;
  var minimumLines = MINIMUM_LINES_AFTER_PAGE_BREAK[typeOfLine] || 1;
  return minimumLines;
}

var getSplitMethod = function(lineInfo) {
  var typeOfLine = lineInfo.typeOfLine;
  if (typeOfLine === "general" || typeOfLine === "transition") {
    return getFirstCharAfterLastSentenceMarkerAndWhitespacesOrFullInnerLine;
  }
  return getFirstCharAfterLastSentenceMarkerAndWhitespacesOfInnerLine;
}

var calculateSplitPosition = function(innerLineNumber, lineInfo, lineNumberShift) {
  var method = getSplitMethod(lineInfo);
  var lineNumberAfterClean = lineInfo.lineNumberBeforeRepagination + lineNumberShift;

  var position = findPositionWhereLineCanBeSplit(innerLineNumber, lineInfo, method);
  // if found position to split, return its split attributes
  if (position) {
    var columnToSplit              = position.columnToSplit;
    var afterLastSentenceThatFits  = [lineNumberAfterClean, columnToSplit];
    var moreAndContdInfo           = getMoreAndContdInfo(lineInfo);
    var caretOriginallyOnFirstHalf = (lineInfo.caretIsAtLine && lineInfo.caretAtColumn <= columnToSplit);

    return {
      addMoreAndContd: moreAndContdInfo,
      lineNumberAfterClean: lineNumberAfterClean,
      start: afterLastSentenceThatFits,
      caretOriginallyOnFirstHalf: caretOriginallyOnFirstHalf,
      innerLinesOnFirstHalf: position.innerLinesOnFirstHalf,
    };
  }
}

// Find position on line that satisfies all conditions:
// - leave minimum lines before page break
// - leave minimum lines after page break
// - can be split on mark defined by findColumnAfterPageBreak() and fit the available space
//
// Return column where line should be split (char that should be 1st on next page) and
// number of inner lines of 1st half
var findPositionWhereLineCanBeSplit = function(innerLineNumber, lineInfo, findColumnAfterPageBreak) {
  var regularLineHeight           = utils.getRegularLineHeight();
  var targetInnerLine             = innerLineNumber;
  var minimumLinesBeforePageBreak = getMinimumLinesBeforePageBreakFor(lineInfo);
  var minimumLinesAfterPageBreak  = getMinimumLinesAfterPageBreakFor(lineInfo);

  var columnAfterPageBreak = findColumnAfterPageBreak(targetInnerLine, lineInfo);
  // only can split element if it has a sentence that fits the available height. If no sentence
  // marker is found, columnAfterPageBreak is 0
  while (columnAfterPageBreak) {
    // found at least one sentence to try to split. Now needs to check if it satisfies the constraints
    // of minimum lines before and after page break for this line type
    var textBeforePageBreak   = lineInfo.lineText.substring(0, columnAfterPageBreak);
    var heightBeforePageBreak = calculateHeightToFitText(textBeforePageBreak, lineInfo);
    var linesBeforePageBreak  = parseInt(heightBeforePageBreak / regularLineHeight);

    if (linesBeforePageBreak < minimumLinesBeforePageBreak) {
      // did not find any place to split line that would keep minimum lines before page break.
      // Don't need to keep looking.
      break;
    }

    // columnAfterPageBreak satisfies minimum lines before page break. Now need to check if it
    // satisfies minimum lines after page break too
    var textAfterPageBreak   = lineInfo.lineText.substring(columnAfterPageBreak);
    var heightAfterPageBreak = calculateHeightToFitText(textAfterPageBreak, lineInfo);
    var linesAfterPageBreak  = parseInt(heightAfterPageBreak / regularLineHeight);

    if (linesAfterPageBreak >= minimumLinesAfterPageBreak) {
      // found an inner line that satisfies all conditions. Now need to prepare data to be returned.

      if (lineInfo.lineHasMarker) {
        // need an adjustment on split position if lineHasMarker, because line will have "*"
        // on the beginning of line
        columnAfterPageBreak++;
      }

      return {
        columnToSplit: columnAfterPageBreak,
        innerLinesOnFirstHalf: linesBeforePageBreak,
      };
    } else {
      // this inner line did not satisfy conditions; try previous one
      targetInnerLine--;
      columnAfterPageBreak = findColumnAfterPageBreak(targetInnerLine, lineInfo);
    }
  }
}

var getMoreAndContdInfo = function(lineInfo) {
  var typeOfLine = lineInfo.typeOfLine;
  if (HAVE_MORE_AND_CONTD[typeOfLine]) {
    return {
      characterName: lineInfo.findCharacterName(),
    };
  }
  return false;
}

var getFirstCharAfterLastSentenceMarkerAndWhitespacesOfInnerLine = function(innerLineNumber, lineInfo) {
  return getFirstCharAfterSeparator(innerLineNumber, lineInfo, false, SENTENCE_MARKER_AND_WHITESPACE_REGEX);
}

var getFirstCharAfterLastSentenceMarkerAndWhitespacesOrFullInnerLine = function(innerLineNumber, lineInfo) {
  return getFirstCharAfterSeparator(innerLineNumber, lineInfo, true, WHITESPACE_REGEX);
}

// Gets position of first char after last occurrence of a separator.
// Parameters:
//   - useEndOfInnerLineAsDefault: flag to indicate if should return position of the end of inner line
//                                 if no separator is found. If false, use 0 as default position.
//   - regex: the regex to look for the separator
var getFirstCharAfterSeparator = function(innerLineNumber, lineInfo, useEndOfInnerLineAsDefault, regex) {
  var lineHasMarker = lineInfo.lineHasMarker;
  var fullText = lineInfo.lineText;

  // get text until the end of target inner line
  var innerLineLength = getInnerLineLengthOf(lineInfo);
  var endOfTargetLine = innerLineNumber * innerLineLength;
  var innerLineText   = fullText.substring(0, endOfTargetLine);

  var firstCharAfterSeparator = useEndOfInnerLineAsDefault ? innerLineText.length : 0;
  if (regex) {
    // look backwards for the last separator of the text
    var separatorPosition = regex.exec(innerLineText);
    if (separatorPosition && separatorPosition[1]) {
      firstCharAfterSeparator = separatorPosition[1].length;
    }
  }

  return firstCharAfterSeparator;
}

var getInnerLineLengthOf = function(lineInfo) {
  var typeOfLine = lineInfo.typeOfLine;
  var lineLength = CHARS_PER_LINE[typeOfLine] || 61;
  return lineLength;
}

var calculateHeightToFitText = function(text, lineInfo) {
  // create a clone to know the height needed
  var $originalLine = lineInfo.$originalLine;
  var $theClone = utils.createCleanCopyOf($originalLine, text);

  // parentheticals need this to calculate line height without any "()"
  $theClone.addClass("clone");

  var height = $theClone.insertAfter($originalLine).get(0).getBoundingClientRect().height;
  $theClone.remove();

  return height;
}

exports.atribsToClasses = function(context) {
  // simple page break, return only the flag as class
  if(isRegularPageBreakAttrib(context.key)) {
    return [context.key];
  }
  // page break with MORE/CONT'D, return also characterName:<character name>
  else if (isPageBreakWithMoreAndContdAttrib(context.key)) {
    var characterName = utils.buildCharacterNameToClass(context.value);
    return [context.key, characterName];
  }
  // any of the halves of a split line, return also the splitId (context.value)
  else if(isFirstHalfOfSplit(context.key) || isSecondHalfOfSplit(context.key)) {
    return [context.key, context.value];
  }
}

var isRegularPageBreakAttrib = function(contextKey) {
  return contextKey === PAGE_BREAKS_ATTRIB;
}

var isPageBreakWithMoreAndContdAttrib = function(contextKey) {
  return contextKey === PAGE_BREAKS_WITH_MORE_AND_CONTD_ATTRIB;
}

var isFirstHalfOfSplit = function(cls) {
  return cls.match(FIRST_HALF_ATTRIB);
}

var isSecondHalfOfSplit = function(cls) {
  return cls.match(SECOND_HALF_ATTRIB);
}

// Bug fix: if user edits first half of split line, for some reason Etherpad is loosing the page break
// line attribute. So we need to collect it:
exports.collectContentPre = function(hook, context) {
  var tname = context.tname;
  var cls   = context.cls || '';
  var state = context.state;
  var lineAttributes = state.lineAttributes;

  var shouldNotCollectThisTag = cls.indexOf(DO_NOT_COLLECT) !== -1;
  if (shouldNotCollectThisTag) return;

  // new line
  if (tname === "div") {
    delete lineAttributes[PAGE_BREAKS_ATTRIB];
    delete lineAttributes[PAGE_BREAKS_WITH_MORE_AND_CONTD_ATTRIB];
    delete lineAttributes[FIRST_HALF_ATTRIB];
    delete lineAttributes[SECOND_HALF_ATTRIB];
  }
  // first half of split line
  else if (tname === FIRST_HALF_TAG) {
    var splitId = getSplitIdFromClass(context.cls);
    lineAttributes[FIRST_HALF_ATTRIB] = splitId;
    lineAttributes[PAGE_BREAKS_ATTRIB] = true;
  } else if (tname === FIRST_HALF_WITH_MORE_AND_CONTD_TAG) {
    var splitId = getSplitIdFromClass(context.cls);
    lineAttributes[FIRST_HALF_ATTRIB] = splitId;
    lineAttributes[PAGE_BREAKS_WITH_MORE_AND_CONTD_ATTRIB] = true;
  }
  // second half of split line
  else if (tname === SECOND_HALF_TAG) {
    var splitId = getSplitIdFromClass(context.cls);
    lineAttributes[SECOND_HALF_ATTRIB] = splitId;
  }
}

// Bug fix: when pasting lines with page breaks, we don't want the page breaks to be collected
exports.dontCollectPageBreaksOfLines = function($lines) {
  var tagsCollected = [FIRST_HALF_TAG, FIRST_HALF_WITH_MORE_AND_CONTD_TAG, SECOND_HALF_TAG];
  var $tagsToNotBeCollected = $lines.find(tagsCollected.join(','));
  $tagsToNotBeCollected.addClass(DO_NOT_COLLECT);
}

exports.buildHtmlWithPageBreaks = function(cls) {
  var extraHTML;
  var splitId = getSplitIdFromClass(cls);

  if (cls.match(PAGE_BREAKS_WITH_MORE_AND_CONTD_ATTRIB)) {
    extraHTML = utils.buildPageBreakWithMoreAndContd(cls, PAGE_BREAK_TAG);

    return {
      preHtml: '<'+FIRST_HALF_WITH_MORE_AND_CONTD_TAG+' class="'+splitId+'">',
      postHtml: extraHTML + '</'+FIRST_HALF_WITH_MORE_AND_CONTD_TAG+'>'
    };
  } else if (cls.match(PAGE_BREAKS_ATTRIB)) {
    extraHTML = utils.buildSimplePageBreak(cls, PAGE_BREAK_TAG);

    return {
      preHtml: '<'+FIRST_HALF_TAG+' class="'+splitId+'">',
      postHtml: extraHTML + '</'+FIRST_HALF_TAG+'>'
    };
  }
  // Bug fix: lines after page break need to be wrapped by a registered block element
  // (see blockElements), otherwise caret will start moving alone when placed
  // on those lines
  else if (isSecondHalfOfSplit(cls)) {
    return {
      preHtml: '<'+SECOND_HALF_TAG+' class="'+splitId+'">',
      postHtml: '</'+SECOND_HALF_TAG+'>'
    };
  }
}

var getSplitIdFromClass = function(cls) {
  var splitId = /(?:^| )(split-[A-Za-z0-9]*)/.exec(cls);
  if(splitId && splitId[1]){
    return splitId[1];
  }
}

var newSplitId = function() {
  return "split-" + randomString(16);
}

exports.blockElements = function() {
  return [FIRST_HALF_TAG, FIRST_HALF_WITH_MORE_AND_CONTD_TAG, SECOND_HALF_TAG];
}

exports.cleanPageBreaks = function(startAtLine, endAtLine, attributeManager, rep, editorInfo) {
  // this loop MUST be from bottom to top! If the direction of the loop needs to be changed, it
  // is necessary to change the value of lineNumberShift every time a line is split
  // (on pageBreak.js, function calculatePageBreaks())
  for (var lineNumber = endAtLine; lineNumber >= startAtLine; lineNumber--) {
    // remove marker(s) of a split line
    if (exports.lineIsFirstHalfOfSplit(lineNumber, attributeManager)) {
      mergeLines(lineNumber, rep, attributeManager, editorInfo);
      removePageBreakBetweenLines(lineNumber, attributeManager);
    }
  }
}

exports.lineIsFirstHalfOfSplit = function(lineNumber, attributeManager) {
  return attributeManager.getAttributeOnLine(lineNumber, FIRST_HALF_ATTRIB);
}

exports.lineIsSecondHalfOfSplit = function(lineNumber, attributeManager) {
  return attributeManager.getAttributeOnLine(lineNumber, SECOND_HALF_ATTRIB);
}

var removePageBreakBetweenLines = function(lineNumber, attributeManager) {
  attributeManager.removeAttributeOnLine(lineNumber, PAGE_BREAKS_ATTRIB);
  attributeManager.removeAttributeOnLine(lineNumber, PAGE_BREAKS_WITH_MORE_AND_CONTD_ATTRIB);

  removeMarkersOfLineSplit(lineNumber, attributeManager);
}

var removeMarkersOfLineSplit = function(lineNumber, attributeManager) {
  attributeManager.removeAttributeOnLine(lineNumber, FIRST_HALF_ATTRIB);
  attributeManager.removeAttributeOnLine(lineNumber+1, SECOND_HALF_ATTRIB);
}

var mergeLines = function(lineNumber, rep, attributeManager, editorInfo) {
  // second half has always the "*" (because it has SECOND_HALF_ATTRIB, for example),
  // so we need to remove it too
  var charsToRemoveOnSecondHalf = 1;

  exports.mergeLinesWithExtraChars(lineNumber, rep, attributeManager, editorInfo, 0, charsToRemoveOnSecondHalf);
}

exports.mergeLinesWithExtraChars = function(lineNumber, rep, attributeManager, editorInfo, charsToRemoveOnFirstHalf, charsToRemoveOnSecondHalf) {
  var splitIdOfFirstHalf = attributeManager.getAttributeOnLine(lineNumber, FIRST_HALF_ATTRIB);
  var splitIdOfSecondHalf = attributeManager.getAttributeOnLine(lineNumber+1, SECOND_HALF_ATTRIB);

  // we only merge if both lines have the same split id
  if (splitIdOfFirstHalf === splitIdOfSecondHalf) {
    var lineText = rep.lines.atIndex(lineNumber).text;
    var lineLength = lineText.length;

    var start = [lineNumber, lineLength - charsToRemoveOnFirstHalf];
    var end = [lineNumber+1, charsToRemoveOnSecondHalf];

    // remove "\n" at the end of the line
    editorInfo.ace_replaceRange(start, end, "");
  }
}

exports.savePageBreak = function(splitPosition, pageNumber, attributeManager, editorInfo, rep) {
  splitLine(splitPosition, attributeManager, editorInfo, rep);
  addPageBreakBetweenLines(splitPosition, pageNumber, attributeManager);
}

var splitLine = function(splitPosition, attributeManager, editorInfo, rep) {
  var splitLine                        = splitPosition.start[0];
  var splitColumn                      = splitPosition.start[1];
  var typeOfLineToBeSplit              = utils.getLineTypeOf(splitLine, attributeManager);
  var caretIsOriginallyAtSplitPosition = (rep.selStart[0] === splitPosition.start[0] && rep.selStart[1] === splitPosition.start[1]);

  editorInfo.ace_replaceRange(splitPosition.start, splitPosition.start, "\n");

  // if caret was at the same place of the split before we started repaginating the script,
  // the insertion of "\n" above moves caret to the beginning of 2nd half of split.
  // If originally caret was on 1st half, we need to move it back one position
  if (caretIsOriginallyAtSplitPosition && splitPosition.caretOriginallyOnFirstHalf) {
    var endOfFirstHalf = [splitLine, splitColumn];
    editorInfo.ace_performSelectionChange(endOfFirstHalf, endOfFirstHalf);
  }

  // we need to make sure both halves of the split line have the same type
  setTypeOfSecondHalfOfLine(splitLine, typeOfLineToBeSplit, attributeManager);
}

var setTypeOfSecondHalfOfLine = function(lineNumber, lineType, attributeManager) {
  scriptElementUtils.updateLineType(lineNumber + 1, attributeManager, lineType);
}

var addPageBreakBetweenLines = function(splitPosition, pageNumber, attributeManager) {
  var lineNumber = splitPosition.start[0];
  var attributeName = PAGE_BREAKS_ATTRIB;
  var attributeValue = true;
  if (splitPosition.addMoreAndContd) {
    attributeName = PAGE_BREAKS_WITH_MORE_AND_CONTD_ATTRIB;
    attributeValue = splitPosition.addMoreAndContd.characterName;
  }

  attributeManager.setAttributeOnLine(lineNumber, attributeName, attributeValue);

  // save page number
  paginationPageNumber.savePageBreak(lineNumber, pageNumber, attributeManager);

  // mark both halves with same id
  var splitId = newSplitId();
  attributeManager.setAttributeOnLine(lineNumber, FIRST_HALF_ATTRIB, splitId);
  attributeManager.setAttributeOnLine(lineNumber+1, SECOND_HALF_ATTRIB, splitId);
}

exports.nodeHasPageBreak = function($node) {
  return $node.find(PAGE_BREAK_TAG).length > 0;
}

exports.lineHasPageBreak = function(lineNumber, attributeManager) {
  return attributeManager.getAttributeOnLine(lineNumber, PAGE_BREAKS_ATTRIB) ||
         attributeManager.getAttributeOnLine(lineNumber, PAGE_BREAKS_WITH_MORE_AND_CONTD_ATTRIB);
}

exports.mergeHelperLines = function($helperLines) {
  var $secondHalvesOfMergedLines = $();

  for (var i = 0; i < $helperLines.length - 1; i++) { // -1: last line cannot be merged to next one
    var $line = $($helperLines.get(i));
    var $nextLine = $($helperLines.get(i+1));
    var fullTextOfLine = fullTextOfSplitLine($line, $nextLine);
    var lineNeedsToBeMerged = !!fullTextOfLine;
    if (lineNeedsToBeMerged) {
      // merge text to fist half
      utils.setTextOfLine($line, fullTextOfLine);

      // mark first half as merged (used later, of pagination calculation)
      $line.addClass(MERGED_LINE);

      // mark second half to be removed
      $secondHalvesOfMergedLines = $secondHalvesOfMergedLines.add($nextLine);

      // move to line after second half
      i++;
    }
  }

  // remove 2nd halves that were merged
  return $helperLines.not($secondHalvesOfMergedLines);
}

var linesAreHalvesOfSameSplit = function($targetLine, $nextLine) {
  var halvesOfSameSplit = false;

  var lineIsFirstHalfOfSplit = $targetLine.find(PAGE_BREAK_TAG).length > 0;
  if (lineIsFirstHalfOfSplit) {
    var firstHalfClass  = $targetLine.find(FIRST_HALF_TAG + "," + FIRST_HALF_WITH_MORE_AND_CONTD_TAG).attr("class");
    var secondHalfClass = $nextLine.find(SECOND_HALF_TAG).attr("class");
    var splitIdOfFirstHalf  = getSplitIdFromClass(firstHalfClass);
    var splitIdOfSecondHalf = getSplitIdFromClass(secondHalfClass);

    halvesOfSameSplit = (splitIdOfFirstHalf === splitIdOfSecondHalf);
  }

  return halvesOfSameSplit;
}
exports.linesAreHalvesOfSameSplit = linesAreHalvesOfSameSplit;

var fullTextOfSplitLine = function($targetLine, $nextLine) {
  if (linesAreHalvesOfSameSplit($targetLine, $nextLine)) {
    // if line is 1st half of split line, join it with next line
    return $targetLine.text() + $nextLine.text();
  }
}
