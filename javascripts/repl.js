function StringStream(string) {
  this.string = string;
  this.index = 0;
  this.length = string.length;
}

StringStream.prototype.getc = function() { return this.string[this.index++]; }
StringStream.prototype.peek = function() { return this.string[this.index]; }
StringStream.prototype.back = function() { this.index--; }
StringStream.prototype.chunk = function(regex) { 
  var match = (this.string.substr(this.index).match(regex || /^[^\s\n\(\)]*/) || [""])[0];
  this.index += match.length;
  return match; 
}
StringStream.prototype.jump = function() { 
  while(/[\s\n]/.test(this.string[this.index])) 
    this.index++;
}
StringStream.prototype.isConsumed = function() { return this.index == this.length; }
StringStream.prototype.rem = function() { return this.string.substr(this.index); }

function Cons(car, cdr) {
  this.car = car;
  this.cdr = cdr;
  this.type = "Cons";
}

NIL = new Cons(); // JS objects only == themselves, so this is OK for comparisons

function Symbol(sym) {
  this.sym = sym;
  this.type = "Symbol";
}

function Fn(form, fn) {
  this.form = form;
  this.fn = fn;
  this.evalArgs = true;
  this.type = "Fn";
}

(function($) {
  var REPL = {
    prompt: "REPL>"
  }

  function Bindings() { }
  Bindings.Core = function() { }

  _b = Bindings;

  function makeFn(argList, body) {
    if (argList === undefined) throw("fn cannot be empty");
    if (type(argList) != "Cons") throw("fn is missing arglist");

    var argAry = listToArray(argList);
    for (a in argAry) if (type(argAry[a]) != "Symbol") throw("only Symbols may be fn args");

    var fn;
    if (body) {
      var fnContext = function() { }
      fnContext.prototype = this;
      fn = function() {
        var localBindings = new fnContext();
        for (i in argAry) localBindings[argAry[i].sym] = arguments[i];
        return evalForm.call(localBindings, body); 
      }
    } else 
      var fn = function() { return NIL; };

    return new Fn(this.__curForm, fn);
  }

  function init() {
    var builtins = ["car", "cdr", "cons", "type",
                    {"quote": {evalArgs: false}},
                    {"eval":  {fn: evalForm}},
                    {"print": {fn: printForm}},
                    {"fn":    {evalArgs: false, fn: makeFn}},
                    {"def":   {evalArgs: false}}];
    $.each(builtins, function(i, sym) {
      var ext = {}, name = sym;
      if (typeof(sym) == "object") {
        for (name in sym);
        ext = sym[name];
      }
      var newSym = new Symbol("#<primitive:"+name+">");
      var newFn = new Fn(newSym, ext.fn || eval(name));
      $.extend(newFn, ext);
      Bindings.Core.prototype[name] = newFn;
    });
    REPL.bindings = new Bindings.Core();
  }

  function UnterminatedInputError() {
    this.restartRead = true;
  }

  function def(sym, binding) {
    if (type(sym) != "Symbol") throw("must bind to symbol");
    if (binding === undefined)
      this[sym.sym] = null;
    else
      this[sym.sym] = evalForm.call(this, binding);
    return sym;
  }

  function quote(form) { 
    return form; 
  }

  function cons(car, cdr) {
    return new Cons(car, cdr);
  }

  function car(cons) { return cons.car; }
  function cdr(cons) { return cons.cdr; }

  function type(form) {
    return form.type || typeof(form);
  }

  REPL.readerFn = function(input) { 
    try {
      var inputStream = new StringStream(input);
      var form = readForm(inputStream);

      inputStream.jump();
      if (! inputStream.isConsumed()) throw("extraneous characters after end of input: \""+inputStream.rem()+'"');
    } catch(err) {
      if (err.restartRead) {
        return false;
      } else
        return "READ ERROR: " + err;
    }

    try {
      return printForm(evalForm.call(REPL.bindings, form));
    } catch(err) {
      return "EVAL ERROR: " + err;
    }
  }

  function readForm(input) {
    input.jump();
    if (input.isConsumed()) throw(new UnterminatedInputError());
    var cur = input.getc();
    if (cur == ')') throw('unexpected ")"');

    if (/\d/.test(cur)) {
      input.back();
      return readNumber(input);
    } else if (cur == "'") {
      return cons(new Symbol("quote"), cons(readForm(input), NIL));
    } else if (cur == '(')
      return readList(input);
    else if (cur == '"')
      return readString(input);
    else {
      input.back();
      return readSymbol(input);
    }
  }
  
  function readNumber(input) {
    var num = input.chunk();
    if (/\./.test(num))
      parsedNum = parseFloat(num);
    else
      parsedNum = parseInt(num);

    if (parsedNum != parsedNum) // NaN
      throw(num + " is not a valid number.");

    return parsedNum;
  }

  function readList(input, idx) {
    input.jump();
    var cur = input.getc();
    if (cur == ".") {
      var form = readForm(input);
      input.jump();
      if (input.getc() != ")") throw('only one form may come after " . "');
      return form;
    } else if (cur == ")")
      return NIL;

    input.back();
    return cons(readForm(input), readList(input));
  }

  function readString(input) {
    var string = "", escapes;
    do {
      var chunk = input.chunk(/[^"]*/);
      string += chunk;
      escapes = (string.match(/\\*$/) || [""])[0];
    } while (escapes.length & 1);
    if (input.getc() != '"') throw(new UnterminatedInputError());
    return string;
  }

  function readSymbol(input) {
    return new Symbol(input.chunk());
  }

  function evalForm(form) {
    switch (type(form)) {
      case "number":
      case "string":
        return form;
      case "Symbol":
        var binding = this[form.sym];
        if (binding === undefined) throw("undefined symbol: " + form.sym);
        if (binding === null) throw("unbound symbol: " + form.sym);
        return binding;
      case "Cons":
        var fn = evalForm.call(this, car(form));
        if (type(fn) != "Fn") throw(printForm(fn) + " is not a function");
        var args = cdr(form);
        if (fn.evalArgs) args = evalList.call(this, args);
        this.__curForm = form;
        var rval = fn.fn.apply(this, listToArray(args));
        this.__curForm = undefined;
        return rval;
    }
  }

  function evalList(list) {
    if (list == NIL)
      return NIL;
    else
      return cons(evalForm.call(this, car(list)), evalList.call(this, cdr(list)));
  }

  function listToArray(list) {
    var ary = [];
    while (list != NIL) {
      ary.push(car(list));
      list = cdr(list);
      if (type(list) != "Cons") throw("invalid use of irregular list");
    }
    return ary;
  }

  function printForm(form) {
    if (form == NIL) return "()";
    switch(type(form)) {
    case "number":
      return form.toString();
    case "string":
      return '"'+form+'"';
    case "Symbol":
      return form.sym;
    case "Cons":
      return "("+printList(form)+")";
    case "Fn":
      return printForm(form.form);
    default:
      throw('type "'+type(form)+'" is invalid');
    }
  }

  function printList(form) {
    if (cdr(form) == NIL)
      return printForm(car(form));
    else if (type(cdr(form)) != "Cons")
      return printForm(car(form)) + " . " + printForm(cdr(form));
    else
      return printForm(car(form)) + " " + printList(cdr(form));
  }

  $.fn.repl = function() {
    init();
    $(this).tty(REPL.prompt, REPL.readerFn);
  }
})(jQuery);
