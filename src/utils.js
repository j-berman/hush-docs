import { saveAs } from 'file-saver'
import $ from 'jquery'

export const downloadFileLocally = (file) => {
  // workaround for Chrome iOS:
  // https://github.com/eligrey/FileSaver.js/issues/179
  if(!navigator.userAgent.match('CriOS')) {
    saveAs(file, file.name)
  } else {
    const reader = new FileReader()
    reader.onload = () => window.location.href = reader.result
    reader.readAsDataURL(file)
  }
}

// converts css to JSON
// https://stackoverflow.com/questions/754607/can-jquery-get-all-css-styles-associated-with-an-element?answertab=votes#tab-top
function css(a) {
  var sheets = document.styleSheets, o = {}
  for (var i in sheets) {
      var rules = sheets[i].rules || sheets[i].cssRules
      for (var r in rules) {
          if (a.is(rules[r].selectorText)) {
              o = $.extend(o, css2json(rules[r].style), css2json(a.attr('style')))
          }
      }
  }
  return o
}

function css2json(css) {
  var s = {}
  if (!css) return s
  if (css instanceof CSSStyleDeclaration) {
      for (var i in css) {
          if ((css[i]).toLowerCase) {
              s[(css[i]).toLowerCase()] = (css[css[i]])
          }
      }
  } else if (typeof css == "string") {
      css = css.split("; ")
      for (var j in css) {
          var l = css[j].split(": ")
          s[l[0].toLowerCase()] = (l[1])
      }
  }
  return s
}

// makes CSS inline
// reworked this a bit: https://stackoverflow.com/questions/4307409/copying-css-to-inline-using-jquery-or-retaining-formatting-when-copying-stuff-f
(function($) {
  $.extend($.fn, {
    makeCssInline: function() {
      this.each(function(idx, el) {
        const style = css($(el))
        const properties = []
        for(const property in style) {
          properties.push(property + ':' + style[property])
        }

        if (this.style) this.style.cssText = properties.join(';')
        else this.style = { cssText: properties.join(';') }

        $(this).children().makeCssInline()
      })
    }
  })
}($))

export const makeCssInline = (jQueryObject) => {
  jQueryObject.makeCssInline()
}

// source: http://code.iamkate.com/javascript/queues
function Queue() {
  let queue = []
  let offset = 0

  this.getLength = () => queue.length - offset

  this.isEmpty = () => queue.length === 0

  this.enqueue = (item) => {
    queue.push(item)
    return this.getLength()
  }

  this.dequeue = () => {
    // get item from front of the queue
    const item = queue[offset]

    offset += 1

    // garbage collect unused space in queue when it grows large
    if (offset * 2 > queue.length) {
      queue = queue.slice(offset)
      offset = 0
    }

    return item
  }

  this.peek = () => queue[offset]
}

export const changeHandlerQueue = new Queue()
