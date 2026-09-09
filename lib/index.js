var t = require("tcomb-validation");
var form = require("./components");

t.form = form;

// CDD : moteur générique (règles conditionnelles, calculs, obligatoires) intégré
// au module et consommé automatiquement par `Form` via sa prop `page`.
t.form.logic = require("./cdd-form-logic");

module.exports = t;
