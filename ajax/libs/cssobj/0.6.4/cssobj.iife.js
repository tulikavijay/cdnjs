/*
  cssobj v0.6.3
  Thu Nov 03 2016 19:00:06 GMT+0800 (HKT)
  commit 9d68892fcd347235ccd8df6a5f7bf7c23caa1c9a

  https://github.com/cssobj/cssobj
  Released under the MIT License.

  Components version info:
  - cssobj-core@0.6.4
    1a6d428bb1a5b2efaf4b7dab2bc5491c6c6b9fd1
  - cssobj-plugin-cssom@2.1.6
    ec55e74a8343f6114f60c1df020da0e0a4e96e74
  - cssobj-plugin-localize@2.0.0
    312ea4e5fdbc1dff201e42fd052d1dfe3d938a4e
*/

var cssobj = (function () {
'use strict';

// helper functions for cssobj

// check n is numeric, or string of numeric
function isNumeric(n) {
  return !isNaN(parseFloat(n)) && isFinite(n)
}

function own(o, k) {
  return {}.hasOwnProperty.call(o, k)
}

// set default option (not deeply)
function defaults(options, defaultOption) {
  options = options || {}
  for (var i in defaultOption) {
    if (own(defaultOption, i) && !(i in options)) options[i] = defaultOption[i]
  }
  return options
}

// convert js prop into css prop (dashified)
function dashify(str) {
  return str.replace(/[A-Z]/g, function(m) {
    return '-' + m.toLowerCase()
  })
}

// capitalize str
function capitalize (str) {
  return str.charAt(0).toUpperCase() + str.substr(1)
}

// repeat str for num times


// don't use String.prototype.trim in cssobj, using below instead


// random string, should used across all cssobj plugins
var random = (function () {
  var count = 0
  return function () {
    count++
    return '_' + Math.floor(Math.random() * Math.pow(2, 32)).toString(36) + count + '_'
  }
})()

// extend obj from source, if it's no key in obj, create one
function extendObj (obj, key, source) {
  obj[key] = obj[key] || {}
  for(var args = arguments, i = 2; i < args.length; i++) {
    source = args[i]
    for (var k in source)
      if (own(source, k)) obj[key][k] = source[k]
  }
  return obj[key]
}

// ensure obj[k] as array, then push v into it
function arrayKV (obj, k, v, reverse, unique) {
  obj[k] = k in obj ? [].concat(obj[k]) : []
  if(unique && obj[k].indexOf(v)>-1) return
  reverse ? obj[k].unshift(v) : obj[k].push(v)
}

// replace find in str, with rep function result
function strSugar (str, find, rep) {
  return str.replace(
    new RegExp('\\\\?(' + find + ')', 'g'),
    function (m, z) {
      return m == z ? rep(z) : z
    }
  )
}

// get parents array from node (when it's passed the test)
function getParents (node, test, key, childrenKey, parentKey) {
  var p = node, path = []
  while(p) {
    if (test(p)) {
      if(childrenKey) path.forEach(function(v) {
        arrayKV(p, childrenKey, v, false, true)
      })
      if(path[0] && parentKey){
        path[0][parentKey] = p
      }
      path.unshift(p)
    }
    p = p.parent
  }
  return path.map(function(p){return key?p[key]:p })
}

// split selector etc. aware of css attributes
function splitComma (str) {
  for (var c, i = 0, n = 0, prev = 0, d = []; c = str.charAt(i); i++) {
    if (c == '(' || c == '[') n++
    if (c == ')' || c == ']') n--
    if (!n && c == ',') d.push(str.substring(prev, i)), prev = i + 1
  }
  return d.concat(str.substring(prev))
}

// checking for valid css value
function isValidCSSValue (val) {
  // falsy: '', NaN, Infinity, [], {}
  return typeof val=='string' && val || typeof val=='number' && isFinite(val)
}

// using var as iteral to help optimize
var KEY_ID = '$id'
var KEY_ORDER = '$order'
var KEY_TEST = '$test'

var TYPE_GROUP = 'group'

// helper function
var keys = Object.keys

// type check helpers
var type = {}.toString
var ARRAY = type.call([])
var OBJECT = type.call({})

// only array, object now treated as iterable
function isIterable (v) {
  return type.call(v) == OBJECT || type.call(v) == ARRAY
}

// check if it's function
function isFunction (v) {
  return typeof v == 'function'
}

// regexp constants
// @page rule: CSSOM:
//   IE returned: not implemented error
//   FF, Chrome actually is not groupRule(not cssRules), same as @font-face rule
//   https://developer.mozilla.org/en-US/docs/Web/API/CSSGroupingRule
//   CSSPageRule is listed as derived from CSSGroupingRule, but not implemented yet.
//   Here added @page as GroupRule, but plugin should take care of this.
var reGroupRule = /^@(media|document|supports|page|[\w-]*keyframes)/i
var reAtRule = /^\s*@/i

/**
 * convert simple Object into node data
 *
 input data format:
 {"a":{"b":{"c":{"":[{color:1}]}}}, "abc":123, '@import':[2,3,4], '@media (min-width:320px)':{ d:{ok:1} }}
 *        1. every key is folder node
 *        2. "":[{rule1}, {rule2}] will split into several rules
 *        3. & will replaced by parent, \\& will escape
 *        4. all prop should be in dom.style camelCase
 *
 * @param {object|array} d - simple object data, or array
 * @param {object} result - the reulst object to store options and root node
 * @param {object} [previousNode] - also act as parent for next node
 * @param {boolean} init whether it's the root call
 * @returns {object} node data object
 */
function parseObj (d, result, node, init) {
  if (init) {
    result.nodes = []
    result.ref = {}
    if (node) result.diff = {}
  }

  node = node || {}

  node.obj = d

  if (type.call(d) == ARRAY) {
    var nodes = []
    /* for array type, each children have a parent that not on the virtual tree,
       see test case of @media-array for example, the array node obj=Array, but have node.selPart(no selText)
       So have to set the right node.at/node.type from the node.key, to get right selText for children */
    node.at = reAtRule.exec(node.key)
    for(var i = 0; i < d.length; i++) {
      var prev = node[i]
      var n = parseObj(d[i], result, node[i] || {parent: node, src: d, parentNode: nodes, index: i})
      if(result.diff && prev!=n) arrayKV(result.diff, n ? 'added' : 'removed', n||prev)
      nodes.push(n)
    }
    return nodes
  } else {
    // it's no need to check (type.call(d) == OBJECT)
    // isIterable will filter only ARRAY/OBJECT
    // other types will goto parseProp function
    var prevVal = node.prevVal = node.lastVal
    // at first stage check $test
    if (KEY_TEST in d) {
      var test = isFunction(d[KEY_TEST]) ? d[KEY_TEST](!node.disabled, node, result) : d[KEY_TEST]
      // if test false, remove node completely
      // if it's return function, going to stage 2 where all prop rendered
      if(!test) {
        return
      }
      node.test = test
    }
    var children = node.children = node.children || {}
    node.lastVal = {}
    node.rawVal = {}
    node.prop = {}
    node.diff = {}
    if (d[KEY_ID]) result.ref[d[KEY_ID]] = node
    var order = d[KEY_ORDER] | 0
    var funcArr = []

    var processObj = function (obj, k, nodeObj) {
      var haveOldChild = k in children
      var newNode = extendObj(children, k, nodeObj)
      // don't overwrite selPart for previous node
      newNode.selPart = newNode.selPart || splitComma(k)
      var n = parseObj(obj, result, newNode)
      if(n) children[k] = n
      // it's new added node
      if (prevVal) !haveOldChild
        ? n && arrayKV(result.diff, 'added', n)
        : !n && arrayKV(result.diff, 'removed', children[k])
      // for first time check, remove from parent (no diff)
      if(!n) delete nodeObj.parent.children[k]
    }

    // only there's no selText, getSel
    if(!('selText' in node)) getSel(node, result)

    for (var k in d) {
      // here $key start with $ is special
      // k.charAt(0) == '$' ... but the core will calc it into node.
      // Plugins should take $ with care and mark as a special case. e.g. ignore it
      if (!own(d, k)) continue
      if (!isIterable(d[k]) || type.call(d[k]) == ARRAY && !isIterable(d[k][0])) {

        // it's inline at-rule: @import etc.
        if (k.charAt(0)=='@') {
          processObj(
            // map @import: [a,b,c] into {a:1, b:1, c:1}
            [].concat(d[k]).reduce(function(prev, cur) {
              prev[cur] = ';'
              return prev
            }, {}), k, {parent: node, src: d, key: k, inline:true})
          continue
        }

        var r = function (_k) {
          // skip $test key
          if(_k != KEY_TEST) parseProp(node, d, _k, result)
        }
        order
          ? funcArr.push([r, k])
          : r(k)
      } else {
        processObj(d[k], k, {parent: node, src: d, key: k})
      }
    }

    // when it's second time visit node
    if (prevVal) {
      // children removed
      for (k in children) {
        if (!(k in d)) {
          arrayKV(result.diff, 'removed', children[k])
          delete children[k]
        }
      }

      // prop changed
      var diffProp = function () {
        var newKeys = keys(node.lastVal)
        var removed = keys(prevVal).filter(function (x) { return newKeys.indexOf(x) < 0 })
        if (removed.length) node.diff.removed = removed
        if (keys(node.diff).length) arrayKV(result.diff, 'changed', node)
      }
      order
        ? funcArr.push([diffProp, null])
        : diffProp()
    }

    if (order) arrayKV(result, '_order', {order: order, func: funcArr})
    result.nodes.push(node)
    return node
  }

}

function getSel(node, result) {

  var opt = result.options

  // array index don't have key,
  // fetch parent key as ruleNode
  var ruleNode = getParents(node, function (v) {
    return v.key
  }).pop()

  node.parentRule = getParents(node.parent, function (n) {
    return n.type == TYPE_GROUP
  }).pop() || null

  if (ruleNode) {
    var isMedia, sel = ruleNode.key
    var groupRule = sel.match(reGroupRule)
    if (groupRule) {
      node.type = TYPE_GROUP
      node.at = groupRule.pop()
      isMedia = node.at == 'media'

      // only media allow nested and join, and have node.selPart
      if (isMedia) node.selPart = splitComma(sel.replace(reGroupRule, ''))

      // combinePath is array, 'str' + array instead of array.join(',')
      node.groupText = isMedia
        ? '@' + node.at + combinePath(getParents(node, function (v) {
          return v.type == TYPE_GROUP
        }, 'selPart', 'selChild', 'selParent'), '', ' and')
      : sel

      node.selText = getParents(node, function (v) {
        return v.selText && !v.at
      }, 'selText').pop() || ''
    } else if (reAtRule.test(sel)) {
      node.type = 'at'
      node.selText = sel
    } else {
      node.selText = '' + combinePath(getParents(ruleNode, function (v) {
        return v.selPart && !v.at
      }, 'selPart', 'selChild', 'selParent'), '', ' ', true), opt
    }

    node.selText = applyPlugins(opt, 'selector', node.selText, node, result)
    if (node.selText) node.selTextPart = splitComma(node.selText)

    if (node !== ruleNode) node.ruleNode = ruleNode
  }

}

/**
 * Parse property of object d's key, with propKey as a candidate key name
 * @param {} node: v-node of cssobj
 * @param {} d: source object
 * @param {} key: any numeric will be ignored, then converted to string
 * @param {} result: cssobj result object
 * @param {} propKey: candidate prop key name

 Accept only key as string, numeric will be ignored

 color: function(){return ['red', 'blue']} will expand
 color: function(){return {fontSize: '12px', float:'right'}} will be replaced

 */
function parseProp (node, d, key, result, propKey) {
  var prevVal = node.prevVal
  var lastVal = node.lastVal

  // the prop name get from object key or candidate key
  var propName = isNumeric(key) ? propKey : key

  // NEXT: propName can be changed by user
  // now it's not used, since propName ensure exists
  // corner case: propKey==='' ?? below line will do wrong!!
  // if(!propName) return

  var prev = prevVal && prevVal[propName]

  ![].concat(d[key]).forEach(function (v) {
    // pass lastVal if it's function
    var rawVal = isFunction(v)
      ? v(prev, node, result)
      : v

    var val = applyPlugins(result.options, 'value', rawVal, propName, node, result, propKey)

    // check and merge only format as Object || Array of Object, other format not accepted!
    if (isIterable(val)) {
      for (var k in val) {
        if (own(val, k)) parseProp(node, val, k, result, propName)
      }
    } else {
      arrayKV(
        node.rawVal,
        propName,
        rawVal,
        true
      )
      if (isValidCSSValue(val)) {
        // only valid val can enter node.prop and lastVal
        // push every val to prop
        arrayKV(
          node.prop,
          propName,
          val,
          true
        )
        prev = lastVal[propName] = val
      }
    }
  })
  if (prevVal) {
    if (!(propName in prevVal)) {
      arrayKV(node.diff, 'added', propName)
    } else if (prevVal[propName] != lastVal[propName]) {
      arrayKV(node.diff, 'changed', propName)
    }
  }
}

function combinePath (array, initialString, seperator, replaceAmpersand) {
  return !array.length ? initialString : array[0].reduce(function (result, value) {
    var str = initialString ? initialString + seperator : initialString
    if (replaceAmpersand) {
      var isReplace = false
      var sugar = strSugar(value, '&', function (z) {
        isReplace = true
        return initialString
      })
      str = isReplace ? sugar : str + sugar
    } else {
      str += value
    }
    return result.concat(combinePath(array.slice(1), str, seperator, replaceAmpersand))
  }, [])
}

function applyPlugins (opt, type) {
  var args = [].slice.call(arguments, 2)
  var plugin = opt.plugins
  // plugin is always Array, so here we don't check it
  return [].concat(plugin).reduce(
    function (pre, plugin) { return plugin[type] ? plugin[type].apply(null, [pre].concat(args)) : pre },
    args.shift()
  )
}

function applyOrder (opt) {
  if (!opt._order) return
  opt._order
    .sort(function (a, b) {
      return a.order - b.order
    })
    .forEach(function (v) {
      v.func.forEach(function (f) {
        f[0](f[1])
      })
    })
  delete opt._order
}

function cssobj$2 (options) {

  options = defaults(options, {
    plugins: [],
    intros: []
  })

  return function (obj, initData) {
    var updater = function (data) {
      if (arguments.length) result.data = data || {}

      result.root = parseObj(extendObj({}, '', result.intro, result.obj), result, result.root, true)
      applyOrder(result)
      result = applyPlugins(options, 'post', result)
      isFunction(options.onUpdate) && options.onUpdate(result)
      return result
    }

    var result = {
      obj: obj||{},
      intro: {},
      update: updater,
      options: options
    }

    ![].concat(options.intros).forEach(
      function(v) {
        extendObj(result, 'intro', isFunction(v) ? v(result) : v)
      }
    )

    updater(initData)

    return result
  }
}

// plugin for cssobj

function createDOM (rootDoc, id, option) {
  var el = rootDoc.getElementById(id)
  if(el) return el
  el = rootDoc.createElement('style')
  rootDoc.getElementsByTagName('head')[0].appendChild(el)
  el.setAttribute('id', id)
  if (option && typeof option == 'object' && option.attrs)
    for (var i in option.attrs) {
      el.setAttribute(i, option.attrs[i])
    }
  return el
}

var addCSSRule = function (parent, selector, body, node) {
  var isImportRule = /@import/i.test(node.selText)
  var rules = parent.cssRules || parent.rules
  var index=0

  var omArr = []
  var str = node.inline
      ? body.map(function(v) {
        return [node.selText, ' ', v]
      })
      : [[selector, '{', body.join(''), '}']]

  str.forEach(function(text) {
    if (parent.cssRules) {
      try {
        index = isImportRule ? 0 : rules.length
        parent.appendRule
          ? parent.appendRule(text.join(''))  // keyframes.appendRule return undefined
          : parent.insertRule(text.join(''), index) //firefox <16 also return undefined...

        omArr.push(rules[index])

      } catch(e) {
        // modern browser with prefix check, now only -webkit-
        // http://shouldiprefix.com/#animations
        // if(selector && selector.indexOf('@keyframes')==0) for(var ret, i = 0, len = cssPrefixes.length; i < len; i++) {
        //   ret = addCSSRule(parent, selector.replace('@keyframes', '@-'+cssPrefixes[i].toLowerCase()+'-keyframes'), body, node)
        //   if(ret.length) return ret
        // }
        // the rule is not supported, fail silently
        // console.log(e, selector, body, pos)
      }
    } else if (parent.addRule) {
      // https://msdn.microsoft.com/en-us/library/hh781508(v=vs.85).aspx
      // only supported @rule will accept: @import
      // old IE addRule don't support 'dd,dl' form, add one by one
      // selector normally is node.selTextPart, but have to be array type
      ![].concat(selector).forEach(function (sel) {
        try {
          // remove ALL @-rule support for old IE
          if(isImportRule) {
            index = parent.addImport(text[2])
            omArr.push(parent.imports[index])

            // IE addPageRule() return: not implemented!!!!
            // } else if (/@page/.test(sel)) {
            //   index = parent.addPageRule(sel, text[2], -1)
            //   omArr.push(rules[rules.length-1])

          } else if (!/^\s*@/.test(sel)) {
            parent.addRule(sel, text[2], rules.length)
            // old IE have bug: addRule will always return -1!!!
            omArr.push(rules[rules.length-1])
          }
        } catch(e) {
          // console.log(e, selector, body)
        }
      })
    }
  })

  return omArr
}

function getBodyCss (node) {
  // get cssText from prop
  var prop = node.prop
  return Object.keys(prop).map(function (k) {
    // skip $prop, e.g. $id, $order
    if(k.charAt(0)=='$') return ''
    for (var v, ret='', i = prop[k].length; i--;) {
      v = prop[k][i]

      // value expand & merge should be done as value function/plugin in cssobj-core >=0.5.0
      ret += node.inline ? k : dashify(prefixProp(k, true)) + ':' + v + ';'
    }
    return ret
  })
}

// vendor prefix support
// borrowed from jQuery 1.12
var cssPrefixes = [ "Webkit", "Moz", "ms", "O" ]
var cssPrefixesReg = new RegExp('^(?:' + cssPrefixes.join('|') + ')[A-Z]')
var emptyStyle = document.createElement( "div" ).style
var testProp  = function (list) {
  for(var i = list.length; i--;) {
    if(list[i] in emptyStyle) return list[i]
  }
}

//
/**
 * cache cssProps
 * the value is JS format, will be used:
 * 1. diff & patch properties for CSSOM
 * 2. vendorPrefix property name checking
 */
var cssProps = {
  // normalize float css property
  'float': testProp(['styleFloat', 'cssFloat', 'float'])
}


// return a css property mapped to a potentially vendor prefixed property
function vendorPropName( name ) {

  // shortcut for names that are not vendor prefixed
  // when name already have '-' as first char, don't prefix
  if ( name in emptyStyle || name.charAt(0) == '-') return

  // check for vendor prefixed names
  var preName, capName = capitalize(name)
  var i = cssPrefixes.length

  while ( i-- ) {
    preName = cssPrefixes[ i ] + capName
    if ( preName in emptyStyle ) return preName
  }
}

// apply prop to get right vendor prefix
// inCSS false=camelcase; true=dashed
function prefixProp (name, inCSS) {
  // $prop will skip
  if(name.charAt(0)=='$') return ''
  // find name and cache the name for next time use
  var retName = cssProps[ name ] ||
      ( cssProps[ name ] = vendorPropName( name ) || name)
  return inCSS   // if hasPrefix in prop
      ? cssPrefixesReg.test(retName) ? capitalize(retName) : name=='float' && name || retName  // fix float in CSS, avoid return cssFloat
      : retName
}

/**
 * Get value and important flag from value str
 * @param {CSSStyleRule} rule css style rule object
 * @param {string} prop prop to set
 * @param {string} val value string
 */
function setCSSProperty (styleObj, prop, val) {
  var value
  var important = /(.*)!(important)\s*$/i.exec(val)
  var propCamel = prefixProp(prop)
  var propDash = prefixProp(prop, true)
  if(important) {
    value = important[1]
    important = important[2]
    if(styleObj.setProperty) styleObj.setProperty(propDash, value, important)
    else {
      // for old IE, cssText is writable, and below is valid for contain !important
      // don't use styleObj.setAttribute since it's not set important
      // should do: delete styleObj[propCamel], but not affect result

      // only work on <= IE8: s.style['FONT-SIZE'] = '12px!important'
      styleObj[propDash.toUpperCase()] = val
      // refresh cssText, the whole rule!
      styleObj.cssText = styleObj.cssText
    }
  } else {
    styleObj[propCamel] = val
  }
}

function cssobj_plugin_post_cssom (option) {
  option = option || {}

  // prefixes array can change the global default vendor prefixes
  if(option.prefixes) cssPrefixes = option.prefixes

  var id = option.name
      ? (option.name+'').replace(/[^a-zA-Z0-9$_-]/g, '')
      : 'style_cssobj' + random()

  var frame = option.frame
  var rootDoc = frame ? frame.contentDocument||frame.contentWindow.document : document
  var dom = createDOM(rootDoc, id, option)
  var sheet = dom.sheet || dom.styleSheet

  // sheet.insertRule ("@import url('test.css');", 0)  // it's ok to insert @import, but only at top
  // sheet.insertRule ("@charset 'UTF-8';", 0)  // throw SyntaxError https://www.w3.org/Bugs/Public/show_bug.cgi?id=22207

  // IE has a bug, first comma rule not work! insert a dummy here
  // addCSSRule(sheet, 'html,body', [], {})

  // helper regexp & function
  // @page in FF not allowed pseudo @page :first{}, with SyntaxError: An invalid or illegal string was specified
  var reWholeRule = /page/i
  var atomGroupRule = function (node) {
    return !node ? false : reWholeRule.test(node.at) || node.parentRule && reWholeRule.test(node.parentRule.at)
  }

  var getParent = function (node) {
    var p = 'omGroup' in node ? node : node.parentRule
    return p && p.omGroup || sheet
  }

  var validParent = function (node) {
    return !node.parentRule || node.parentRule.omGroup !== null
  }

  var removeOneRule = function (rule) {
    if (!rule) return
    var parent = rule.parentRule || sheet
    var rules = parent.cssRules || parent.rules
    var removeFunc = function (v, i) {
      if((v===rule)) {
        parent.deleteRule
          ? parent.deleteRule(rule.keyText || i)
          : parent.removeRule(i)
        return true
      }
    }
    // sheet.imports have bugs in IE:
    // > sheet.removeImport(0)  it's work, then again
    // > sheet.removeImport(0)  it's not work!!!
    //
    // parent.imports && [].some.call(parent.imports, removeFunc)
    ![].some.call(rules, removeFunc)
  }

  function removeNode (node) {
    // remove mediaStore for old IE
    var groupIdx = mediaStore.indexOf(node)
    if (groupIdx > -1) {
      // before remove from mediaStore
      // don't forget to remove all children, by a walk
      node.mediaEnabled = false
      walk(node)
      mediaStore.splice(groupIdx, 1)
    }
    // remove Group rule and Nomal rule
    ![node.omGroup].concat(node.omRule).forEach(removeOneRule)
  }

  // helper function for addNormalrule
  var addNormalRule = function (node, selText, cssText) {
    if(!cssText) return
    // get parent to add
    var parent = getParent(node)
    if (validParent(node))
      return node.omRule = addCSSRule(parent, selText, cssText, node)
    else if (node.parentRule) {
      // for old IE not support @media, check mediaEnabled, add child nodes
      if (node.parentRule.mediaEnabled) {
        if (!node.omRule) return node.omRule = addCSSRule(parent, selText, cssText, node)
      }else if (node.omRule) {
        node.omRule.forEach(removeOneRule)
        delete node.omRule
      }
    }
  }

  var mediaStore = []

  var checkMediaList = function () {
    mediaStore.forEach(function (v) {
      v.mediaEnabled = v.mediaTest(rootDoc)
      walk(v)
    })
  }

  if (window.attachEvent) {
    window.attachEvent('onresize', checkMediaList)
  } else if (window.addEventListener) {
    window.addEventListener('resize', checkMediaList, true)
  }

  var walk = function (node, store) {
    if (!node) return

    // cssobj generate vanilla Array, it's safe to use constructor, fast
    if (node.constructor === Array) return node.map(function (v) {walk(v, store)})

    // skip $key node
    if(node.key && node.key.charAt(0)=='$' || !node.prop) return

    // nested media rule will pending proceed
    if(node.at=='media' && node.selParent && node.selParent.postArr) {
      return node.selParent.postArr.push(node)
    }

    node.postArr = []
    var children = node.children
    var isGroup = node.type == 'group'

    if (atomGroupRule(node)) store = store || []

    if (isGroup) {
      // if it's not @page, @keyframes (which is not groupRule in fact)
      if (!atomGroupRule(node)) {
        var reAdd = 'omGroup' in node
        if (node.at=='media' && option.noMedia) node.omGroup = null
        else [''].concat(cssPrefixes).some(function (v) {
          return node.omGroup = addCSSRule(
            // all groupRule will be added to root sheet
            sheet,
            '@' + (v ? '-' + v.toLowerCase() + '-' : v) + node.groupText.slice(1), [], node
          ).pop() || null
        })


        // when add media rule failed, build test function then check on window.resize
        if (node.at == 'media' && !reAdd && !node.omGroup) {
          // build test function from @media rule
          var mediaTest = new Function('doc',
            'return ' + node.groupText
              .replace(/@media\s*/i, '')
              .replace(/min-width:/ig, '>=')
              .replace(/max-width:/ig, '<=')
              .replace(/(px)?\s*\)/ig, ')')
              .replace(/\band\b/ig, '&&')
              .replace(/,/g, '||')
              .replace(/\(/g, '(doc.documentElement.offsetWidth')
          )

          try {
            // first test if it's valid function
            var mediaEnabled = mediaTest(rootDoc)
            node.mediaTest = mediaTest
            node.mediaEnabled = mediaEnabled
            mediaStore.push(node)
          } catch(e) {}
        }
      }
    }

    var selText = node.selTextPart
    var cssText = getBodyCss(node)

    // it's normal css rule
    if (cssText.join('')) {
      if (!atomGroupRule(node)) {
        addNormalRule(node, selText, cssText)
      }
      store && store.push(selText ? selText + ' {' + cssText.join('') + '}' : cssText)
    }

    for (var c in children) {
      // empty key will pending proceed
      if (c === '') node.postArr.push(children[c])
      else walk(children[c], store)
    }

    if (isGroup) {
      // if it's @page, @keyframes
      if (atomGroupRule(node) && validParent(node)) {
        addNormalRule(node, node.groupText, store)
        store = null
      }
    }

    // media rules need a stand alone block
    var postArr = node.postArr
    delete node.postArr
    postArr.map(function (v) {
      walk(v, store)
    })
  }

  return {
    post: function (result) {
      result.cssdom = dom
      if (!result.diff) {
        // it's first time render
        walk(result.root)
      } else {
        // it's not first time, patch the diff result to CSSOM
        var diff = result.diff

        // node added
        if (diff.added) diff.added.forEach(function (node) {
          walk(node)
        })

        // node removed
        if (diff.removed) diff.removed.forEach(function (node) {
          // also remove all child group & sel
          node.selChild && node.selChild.forEach(removeNode)
          removeNode(node)
        })

        // node changed, find which part should be patched
        if (diff.changed) diff.changed.forEach(function (node) {
          var om = node.omRule
          var diff = node.diff

          if (!om) om = addNormalRule(node, node.selTextPart, getBodyCss(node))

          // added have same action as changed, can be merged... just for clarity
          diff.added && diff.added.forEach(function (v) {
            v && om && om.forEach(function (rule) {
              try{
                setCSSProperty(rule.style, v, node.prop[v][0])
              }catch(e){}
            })
          })

          diff.changed && diff.changed.forEach(function (v) {
            v && om && om.forEach(function (rule) {
              try{
                setCSSProperty(rule.style, v, node.prop[v][0])
              }catch(e){}
            })
          })

          diff.removed && diff.removed.forEach(function (v) {
            var prefixV = prefixProp(v)
            prefixV && om && om.forEach(function (rule) {
              try{
                rule.style.removeProperty
                  ? rule.style.removeProperty(prefixV)
                  : rule.style.removeAttribute(prefixV)
              }catch(e){}
            })
          })
        })
      }

      return result
    }
  }
}

// cssobj plugin

var reClass = /:global\s*\(((?:\s*\.[A-Za-z0-9_-]+\s*)+)\)|(\.)([!A-Za-z0-9_-]+)/g

function cssobj_plugin_selector_localize(prefix, localNames) {

  prefix = prefix!=='' ? prefix || random() : ''

  localNames = localNames || {}

  var replacer = function (match, global, dot, name) {
    if (global) {
      return global
    }
    if (name[0] === '!') {
      return dot + name.substr(1)
    }

    return dot + (name in localNames
                  ? localNames[name]
                  : prefix + name)
  }

  var mapSel = function(str, isClassList) {
    return str.replace(reClass, replacer)
  }

  var mapClass = function(str) {
    return mapSel((' '+str).replace(/\s+\.?/g, '.')).replace(/\./g, ' ')
  }

  return {
    selector: function localizeName (sel, node, result) {
      // don't touch at rule's selText
      // it's copied from parent, which already localized
      if(node.at) return sel
      if(!result.mapSel) result.mapSel = mapSel, result.mapClass = mapClass
      return mapSel(sel)
    }
  }
}

// cssobj is simply an intergration for cssobj-core, cssom

function cssobj (obj, option, initData) {
  option = option||{}

  var local = option.local
  option.local = !local
    ? {prefix:''}
  : local && typeof local==='object' ? local : {}

  option.plugins = [].concat(
    option.plugins||[],
    cssobj_plugin_selector_localize(option.local.prefix, option.local.localNames),
    cssobj_plugin_post_cssom(option.cssom)
  )

  return cssobj$2(option)(obj, initData)
}

cssobj.version = '0.6.3'

return cssobj;

}());
