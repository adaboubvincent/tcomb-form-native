/**
 * CDD — Moteur générique de conditionnalité / calculs / obligatoires pour les
 * formulaires de tâche, INTÉGRÉ au module (auparavant dans
 * src/utils/formLogicEngine.js + src/utils/formCalculations.js).
 *
 * Consommé automatiquement par le composant `Form` (voir components.js) dès
 * qu'on lui passe la prop `page` = un élément de `task.form` :
 *   {
 *     options:   { fields: { <name>: <opts>, ... } },
 *     page:      { type:'object', properties:{...}, required:[...] },  // JSON-schema
 *     rules:     [ { when:<cond>, then:[ {action, target} ] } ],
 *     calculate: [ { target:"<chemin pointé>", expr:"<expression>" } ],
 *     messages:  { <nomChampFeuille>: { required, range, regex } }
 *   }
 *
 * <cond> = { field:<path>, op:<op>, value:<any> } | { all:[...] } | { any:[...] }
 * <op>   = eq|ne|in|nin|gt|gte|lt|lte|contains|empty|notEmpty
 * action = show|hide|require|optional|enable|disable
 * <path> = "champ" | "groupe.champ" ; "$<index>.<path>" -> autre page (allResponses)
 *
 * Aucune dépendance externe, pas d'`eval`.
 */
'use strict';

/* ============================================================= utilitaires */

function isEmpty(v) {
  return (
    v === undefined ||
    v === null ||
    v === '' ||
    (Array.isArray(v) && v.length === 0)
  );
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  var n = parseFloat(v);
  return isNaN(n) ? NaN : n;
}

function resolvePath(root, path) {
  if (!path) return undefined;
  var parts = String(path).split('.');
  var cur = root;
  for (var i = 0; i < parts.length; i++) {
    if (cur == null) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

function setPath(root, path, value) {
  var parts = String(path).split('.');
  var cur = root;
  for (var k = 0; k < parts.length - 1; k++) {
    if (cur[parts[k]] == null || typeof cur[parts[k]] !== 'object') cur[parts[k]] = {};
    cur = cur[parts[k]];
  }
  cur[parts[parts.length - 1]] = value;
}

// Clone profond qui PRÉSERVE les fonctions par référence (ex. `options.fields.
// <geo>.factory` = composant React) — contrairement à JSON.parse(JSON.stringify).
function cloneDeepKeepFns(v) {
  if (v == null || typeof v !== 'object') return v;
  if (typeof v === 'function') return v;
  if (Array.isArray(v)) {
    var arr = new Array(v.length);
    for (var i = 0; i < v.length; i++) arr[i] = cloneDeepKeepFns(v[i]);
    return arr;
  }
  var out = {};
  for (var k in v) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
    // `dataset` (snapshot d'une source dynamique : jusqu'à des milliers de
    // lignes) est en lecture seule -> partagé par référence, pas recopié à
    // chaque rendu.
    if ((k === 'dataset' || k === 'options') && Array.isArray(v[k])) {
      out[k] = v[k];
      continue;
    }
    out[k] = cloneDeepKeepFns(v[k]);
  }
  return out;
}

// Copie profonde d'une RÉPONSE (objets / tableaux) qui garde les dates en objets Date.
// JSON.parse(JSON.stringify(...)) les changeait en chaînes : sur une page avec calculs (ou après
// une purge de cascade), le champ date recevait du texte, tcomb (t.Date) le refusait et la date
// renseignée s'affichait en rouge à « Envoyer » / « Enregistrer sans envoyer » / « Suivant ».
function cloneValue(v) {
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(cloneValue);
  if (v && typeof v === 'object') {
    var out = {};
    Object.keys(v).forEach(function (k) {
      if (v[k] !== undefined) out[k] = cloneValue(v[k]);
    });
    return out;
  }
  return v;
}

function hasDeclarativeLogic(page) {
  return !!(
    page &&
    ((Array.isArray(page.rules) && page.rules.length) ||
      (Array.isArray(page.calculate) && page.calculate.length) ||
      (Array.isArray(page.autofill) && page.autofill.length))
  );
}

// Vrai si la page porte au moins un champ à source dynamique
// (`options.fields.<...>.dataset`) -> il faut passer par buildDynamicOptions
// même sans règles/calculs.
function _anyDatasetInFields(fields) {
  var keys = Object.keys(fields || {});
  for (var i = 0; i < keys.length; i++) {
    var f = fields[keys[i]];
    if (!f || typeof f !== 'object') continue;
    if (Array.isArray(f.dataset)) return true;
    if (f.fields && _anyDatasetInFields(f.fields)) return true;
    if (f.item && f.item.fields && _anyDatasetInFields(f.item.fields)) return true;
  }
  return false;
}
function _anyOrderInFields(fields) {
  var keys = Object.keys(fields || {});
  for (var i = 0; i < keys.length; i++) {
    var f = fields[keys[i]];
    if (!f || typeof f !== 'object') continue;
    if (Array.isArray(f.order)) return true;
    if (f.fields && _anyOrderInFields(f.fields)) return true;
    if (f.item && (Array.isArray(f.item.order) || _anyOrderInFields(f.item.fields))) return true;
  }
  return false;
}
function hasDynamicOptions(page) {
  if (hasDeclarativeLogic(page)) return true;
  var o = page && page.options;
  if (!o) return false;
  return Array.isArray(o.order) || _anyDatasetInFields(o.fields) || _anyOrderInFields(o.fields);
}

// Recopie `order` (et `item.order`) de la page vers les options effectives :
// l'écran reconstruit son objet `options` et peut perdre ces clés, alors que
// PostgreSQL/jsonb a de toute façon détruit l'ordre des clés d'objet.
function applyFieldOrder(options, srcOptions) {
  if (!options || !srcOptions || typeof srcOptions !== 'object') return options;
  if (Array.isArray(srcOptions.order) && !Array.isArray(options.order)) {
    options.order = srcOptions.order.slice();
  }
  if (options.fields && srcOptions.fields) {
    Object.keys(options.fields).forEach(function (k) {
      if (srcOptions.fields[k]) applyFieldOrder(options.fields[k], srcOptions.fields[k]);
    });
  }
  if (options.item && srcOptions.item) applyFieldOrder(options.item, srcOptions.item);
  return options;
}

/* ================================ mise en forme valeur -> schéma courant */

// Le type d'un champ peut avoir changé côté builder (ex. select_one ->
// select_multiple) alors qu'une réponse est déjà stockée avec l'ancienne forme
// (chaîne au lieu de tableau). tcomb-form-native plante alors (`value.map`).
// On aligne la valeur sur le schéma courant AVANT le rendu ; l'écran se
// resynchronise au 1er onChange.
// Dates : l'application déclare les formats date / datetime / time comme `t.Date` (objet Date). Une
// réponse enregistrée puis relue (JSON : base locale, copie JSON.parse(JSON.stringify(...)) des écrans)
// revient en CHAÎNE -> tcomb la refusait et l'écran annonçait « champs obligatoires » alors que la date
// était renseignée (Tâches : 2e passage sur « Suivant » ; COSOCollect : « Envoyer » / « Enregistrer et
// quitter »). Une chaîne de date reconnue redevient un objet Date ; une chaîne illisible est laissée
// telle quelle (elle reste signalée, comme avant).
var _DATE_FORMATS = { date: 1, datetime: 1, time: 1 };
function _toDate(text) {
  var s = String(text).trim();
  if (!s) return null;
  var m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) {   // JJ-MM-AAAA [HH:mm[:ss]] (affichage mobile, saisies historiques)
    var d1 = new Date(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
    return d1.getMonth() === +m[2] - 1 && d1.getDate() === +m[1] ? d1 : null;
  }
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) {   // heure seule
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), +m[1], +m[2], m[3] ? +m[3] : 0);
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {   // AAAA-MM-JJ : jour local (pas minuit UTC)
    var d2 = new Date(+m[1], +m[2] - 1, +m[3]);
    return d2.getMonth() === +m[2] - 1 && d2.getDate() === +m[3] ? d2 : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d/.test(s)) return null;   // ISO 8601 (Date.toJSON, web)
  var d3 = new Date(s.replace(' ', 'T'));
  return isNaN(d3.getTime()) ? null : d3;
}

function _coerceToSchema(schema, val) {
  if (!schema || typeof schema !== 'object') return val;
  var tp = schema.type;
  if (tp === 'string' && _DATE_FORMATS[schema.format]) {
    if (typeof val === 'string') {
      if (!val.trim()) return undefined;   // chaîne vide = non renseigné (et non « date invalide »)
      var parsed = _toDate(val);
      return parsed || val;
    }
    return val;
  }
  if (tp === 'object' && schema.properties) {
    if (val == null || typeof val !== 'object' || Array.isArray(val)) return val;
    var out = null;
    Object.keys(schema.properties).forEach(function (k) {
      var cv = _coerceToSchema(schema.properties[k], val[k]);
      if (cv !== val[k]) {
        if (!out) out = Object.assign({}, val);
        out[k] = cv;
      }
    });
    return out || val;
  }
  if (tp === 'array') {
    if (Array.isArray(val)) {
      // groupe répétable : chaque ligne est réalignée (dates des lignes comprises)
      if (schema.items && schema.items.type === 'object') {
        var rows = null;
        val.forEach(function (row, i) {
          var cr = _coerceToSchema(schema.items, row);
          if (cr !== row) {
            if (!rows) rows = val.slice();
            rows[i] = cr;
          }
        });
        return rows || val;
      }
      return val;                                 // déjà un tableau : on n'y touche pas
    }
    if (val == null || val === '') return undefined;
    return [val];                                 // scalaire (ancien select_one) -> tableau
  }
  // champ scalaire attendu : un tableau (ancien select_multiple) -> 1re valeur
  if (Array.isArray(val)) return val.length ? val[0] : undefined;
  return val;
}
function coerceValueToSchema(page, value) {
  return page && page.page ? _coerceToSchema(page.page, value) : value;
}

// Mode du calendrier déduit du format : le générateur web ne pose `options.mode` que pour
// « date » ; « datetime » / « time » arrivaient sans mode et le gabarit Android levait
// « Unrecognized date picker format undefined » (écran planté). Renvoie `options` tel quel si
// rien ne manque, sinon une copie le long des chemins complétés (options de l'écran non mutées).
function _withDateModes(schema, opts) {
  var props = (schema && schema.properties) || {};
  var fields = (opts && opts.fields) || {};
  var newFields = null;
  Object.keys(props).forEach(function (k) {
    var p = props[k] || {};
    var f = fields[k];
    var nf = f;
    if (p.type === 'string' && _DATE_FORMATS[p.format]) {
      if (!f || !f.mode) nf = Object.assign({}, f || {}, { mode: p.format });
    } else if (p.type === 'object' && f && f.fields) {
      nf = _withDateModes(p, f);
    } else if (p.type === 'array' && p.items && p.items.type === 'object' && f && f.item) {
      var ni = _withDateModes(p.items, f.item);
      if (ni !== f.item) nf = Object.assign({}, f, { item: ni });
    }
    if (nf !== f) {
      if (!newFields) newFields = Object.assign({}, fields);
      newFields[k] = nf;
    }
  });
  return newFields ? Object.assign({}, opts || {}, { fields: newFields }) : opts;
}
function applyDateModes(page, options) {
  return page && page.page ? _withDateModes(page.page, options) : options;
}

// Nb min / max de lignes d'un groupe répétable (`minItems` / `maxItems` du
// schéma) et message personnalisé (`page.messages[<clé>].rows`) recopiés sur
// les options du répétable (`cddMinItems`, `cddMaxItems`, `cddRowsMessage`),
// lus par le composant `List`. Nécessaire : un répétable n'est jamais dans
// `required` (t.maybe), donc « aucune ligne » passait toujours la validation
// tcomb. Même principe de copie que _withDateModes (options de l'écran non mutées).
function _withRepeatBounds(schema, opts, messages) {
  var props = (schema && schema.properties) || {};
  var fields = (opts && opts.fields) || {};
  var newFields = null;
  function put(k, nf) {
    if (!newFields) newFields = Object.assign({}, fields);
    newFields[k] = nf;
  }
  Object.keys(props).forEach(function (k) {
    var p = props[k] || {};
    var f = fields[k];
    if (p.type === 'object' && p.properties) {
      var sub = _withRepeatBounds(p, f, messages);
      if (sub !== f) put(k, sub);
    } else if (p.type === 'array' && p.items && p.items.type === 'object') {
      var nf = f;
      var ni = _withRepeatBounds(p.items, f && f.item, messages);
      if (ni !== (f && f.item)) nf = Object.assign({}, nf || {}, { item: ni });
      var min = typeof p.minItems === 'number' ? p.minItems : null;
      var max = typeof p.maxItems === 'number' ? p.maxItems : null;
      var msg = (messages[k] && messages[k].rows) || null;
      if ((min !== null || max !== null || msg) &&
          (!nf || nf.cddMinItems !== min || nf.cddMaxItems !== max || nf.cddRowsMessage !== msg)) {
        nf = Object.assign({}, nf || {}, { cddMinItems: min, cddMaxItems: max, cddRowsMessage: msg });
      }
      if (nf !== f) put(k, nf);
    }
  });
  return newFields ? Object.assign({}, opts || {}, { fields: newFields }) : opts;
}
// Champs « Note / libellé » (`_note: true` dans le schéma) : marqués
// `cddNote` sur leurs options -> le Textbox les rend en simple texte en gras,
// sans zone de saisie (au lieu d'un champ désactivé). Même principe de copie
// que _withRepeatBounds (options de l'écran non mutées) ; groupes et lignes de
// répétable compris.
function _withNotes(schema, opts) {
  var props = (schema && schema.properties) || {};
  var fields = (opts && opts.fields) || {};
  var newFields = null;
  function put(k, nf) {
    if (!newFields) newFields = Object.assign({}, fields);
    newFields[k] = nf;
  }
  Object.keys(props).forEach(function (k) {
    var p = props[k] || {};
    var f = fields[k];
    if (p._note) {
      if (!f || f.cddNote !== true) put(k, Object.assign({}, f || {}, { cddNote: true }));
    } else if (p.type === 'object' && p.properties) {
      var sub = _withNotes(p, f);
      if (sub !== f) put(k, sub);
    } else if (p.type === 'array' && p.items && p.items.type === 'object' && (!f || typeof f.item !== 'function')) {
      var ni = _withNotes(p.items, f && f.item);
      if (ni !== (f && f.item)) put(k, Object.assign({}, f || {}, { item: ni }));
    }
  });
  return newFields ? Object.assign({}, opts || {}, { fields: newFields }) : opts;
}
function applyNoteFields(page, options) {
  return page && page.page ? _withNotes(page.page, options) : options;
}

function applyRepeatBounds(page, options) {
  return page && page.page ? _withRepeatBounds(page.page, options, page.messages || {}) : options;
}

/* ============================================================== conditions */

function resolveField(field, values, allResponses) {
  if (typeof field === 'string' && field.charAt(0) === '$') {
    var dot = field.indexOf('.');
    var idx = parseInt(field.slice(1, dot === -1 ? undefined : dot), 10);
    var rest = dot === -1 ? '' : field.slice(dot + 1);
    var pageValues = (allResponses || [])[idx] || {};
    return rest ? resolvePath(pageValues, rest) : pageValues;
  }
  return resolvePath(values || {}, field);
}

// Valeur d'un champ de condition. `scopes` (lignes de répétable en cours, cf.
// _calcLookup) : un champ du même répétable que la cible est lu dans LA ligne.
// Un chemin qui traverse un répétable hors de ces lignes renvoie la colonne
// ({multi:true, value:[valeur de chaque ligne]}).
function _condValue(field, values, allResponses, scopes) {
  if (typeof field === 'string' && field.charAt(0) === '$') {
    var dot = field.indexOf('.');
    var idx = parseInt(field.slice(1, dot === -1 ? undefined : dot), 10);
    var rest = dot === -1 ? '' : field.slice(dot + 1);
    var pageValues = (allResponses || [])[idx] || {};
    return rest ? _columnInfo(pageValues, rest) : { multi: false, value: pageValues };
  }
  var sc = scopes || [];
  for (var s = sc.length - 1; s >= 0; s--) {
    var pre = sc[s].path + '.';
    if (String(field).indexOf(pre) === 0) return _columnInfo(sc[s].row, String(field).slice(pre.length));
  }
  return _columnInfo(values || {}, field);
}

// Opérateurs « négatifs » : sur une colonne de répétable, vrais si AUCUNE ligne
// ne contredit (toutes les lignes) ; les autres : vrais si AU MOINS une ligne.
var _NEGATIVE_OPS = { ne: 1, nin: 1, empty: 1 };

function evaluateCondition(cond, values, allResponses, scopes) {
  if (!cond || typeof cond !== 'object') return true;
  if (Array.isArray(cond.all)) {
    return cond.all.every(function (c) { return evaluateCondition(c, values, allResponses, scopes); });
  }
  if (Array.isArray(cond.any)) {
    return cond.any.some(function (c) { return evaluateCondition(c, values, allResponses, scopes); });
  }

  var info = _condValue(cond.field, values, allResponses, scopes);
  if (info.multi) {
    var test = function (v) { return _testOp(cond.op, v, cond.value); };
    return _NEGATIVE_OPS[cond.op] ? info.value.every(test) : info.value.some(test);
  }
  return _testOp(cond.op, info.value, cond.value);
}

function _testOp(op, actual, expected) {
  switch (op) {
    case 'eq': return String(actual) === String(expected);
    case 'ne': return String(actual) !== String(expected);
    case 'gt': return toNumber(actual) > toNumber(expected);
    case 'gte': return toNumber(actual) >= toNumber(expected);
    case 'lt': return toNumber(actual) < toNumber(expected);
    case 'lte': return toNumber(actual) <= toNumber(expected);
    case 'in':
      return Array.isArray(actual)
        ? actual.map(String).indexOf(String(expected)) !== -1
        : String(actual) === String(expected);
    case 'nin':
      return Array.isArray(actual)
        ? actual.map(String).indexOf(String(expected)) === -1
        : String(actual) !== String(expected);
    case 'contains':
      return String(actual == null ? '' : actual).indexOf(String(expected)) !== -1;
    case 'empty': return isEmpty(actual);
    case 'notEmpty': return !isEmpty(actual);
    default: return true;
  }
}

/* ====================================================== options dynamiques */

function optionNodeAtPath(options, path) {
  var parts = String(path).split('.');
  var node = options;
  for (var i = 0; i < parts.length; i++) {
    if (!node.fields) node.fields = {};
    if (!node.fields[parts[i]]) node.fields[parts[i]] = {};
    node = node.fields[parts[i]];
  }
  return node;
}

/**
 * Applique les `rules` de la page à une COPIE de `baseOptions`. Chaque appel
 * recalcule tout depuis zéro pour chaque champ ciblé -> effets RÉVERSIBLES.
 * On ne touche que `hidden` / `editable` / `disabled` / `__ruleRequired`
 * (le style / `factory` posés en amont sont préservés).
 */
function buildDynamicOptions(page, values, allResponses, baseOptions) {
  var options = cloneDeepKeepFns(
    baseOptions && Object.keys(baseOptions).length
      ? baseOptions
      : (page && page.options) || {}
  );
  if (!page) return options;

  // Un champ CIBLE de `page.calculate` est toujours en lecture seule côté
  // mobile : sa valeur est recalculée à chaque frappe (cf. `applyCalculations`,
  // appelé par `_cddHandleChange` dans components.js AVANT de remonter la
  // valeur) — une saisie manuelle y serait de toute façon écrasée au
  // changement suivant. Appliqué ICI, inconditionnellement (indépendant de
  // `page.rules`, et TOUJOURS en dernier ci-dessous) pour qu'aucune règle
  // `enable` ne puisse jamais réactiver un champ calculé par erreur. Même
  // convention double `editable`/`disabled` que l'action `disable` des
  // `rules` (cf. plus bas) : les 2 flags sont lus par des templates
  // différents selon le type de widget (Textbox lit `editable`, Select/Date
  // lisent `disabled`).
  function markCalculatedTargetsDisabled() {
    calculatedTargets(page).forEach(function (target) {
      var node = optionNodeAtSchemaPath(page, options, target);
      node.editable = false;
      node.disabled = true;
    });
    markAutofillLocked(page, options);
  }

  if (!Array.isArray(page.rules) || !page.rules.length) {
    markCalculatedTargetsDisabled();
    return applyDatasets(applyFieldOrder(options, page && page.options), values, allResponses);
  }

  // Règle dont la cible est DANS un groupe répétable : appliquée ligne par
  // ligne (cf. _installRowRules). Les autres : au niveau de la page.
  var pageActs = [];
  var rowActs = [];
  page.rules.forEach(function (rule) {
    var met = null;
    (rule.then || []).forEach(function (act) {
      if (!act || !act.target || !act.action) return;
      var segs = _repeatSegments(page, act.target);
      if (segs.length > 1) {
        rowActs.push({ when: rule.when, action: act.action, segs: segs, k: 1 });
        return;
      }
      if (met === null) met = !!evaluateCondition(rule.when, values, allResponses);
      pageActs.push({ target: act.target, action: act.action, met: met });
    });
  });

  _applyRuleActs(options, pageActs);

  markCalculatedTargetsDisabled();

  options = applyDatasets(applyFieldOrder(options, page && page.options), values, allResponses);
  _installRowRules(options, rowActs, values, allResponses);
  return options;
}

// Applique des actions de règle évaluées ([{target, action, met}]) aux options
// `options` (mutation). Chemins relatifs à `options` (groupes uniquement).
function _applyRuleActs(options, acts) {
  var agg = {}; // target -> { show:bool[], hide:bool[], require:bool[], ... }
  acts.forEach(function (a) {
    var bucket = agg[a.target] || (agg[a.target] = {});
    (bucket[a.action] || (bucket[a.action] = [])).push(!!a.met);
  });

  var some = function (a) { return Array.isArray(a) && a.some(Boolean); };
  var has = function (b, k) { return Array.isArray(b[k]) && b[k].length > 0; };

  Object.keys(agg).forEach(function (target) {
    var b = agg[target];
    var node = optionNodeAtPath(options, target);

    if (has(b, 'show') || has(b, 'hide')) {
      var hiddenByHide = has(b, 'hide') && some(b.hide);
      var hiddenByShow = has(b, 'show') && !some(b.show);
      node.hidden = hiddenByHide || hiddenByShow;
    }

    if (has(b, 'require') || has(b, 'optional')) {
      node.__ruleRequired =
        has(b, 'require') && some(b.require) &&
        !(has(b, 'optional') && some(b.optional));
      if (node.__ruleRequired && !(has(b, 'hide') && some(b.hide))) {
        node.hidden = false;
      }
    }

    if (has(b, 'enable') || has(b, 'disable')) {
      var disabled =
        (has(b, 'disable') && some(b.disable)) ||
        (has(b, 'enable') && !some(b.enable));
      node.editable = !disabled;
      node.disabled = disabled;
    }
  });
}

// Options d'une LIGNE de répétable calculées à la volée : `item` devient une
// fonction (rowValue, index) -> options (forme acceptée par tcomb-form-native,
// cf. getComponentOptions / List.getItems). `fn.fields` pointe vers les champs
// statiques : les traitements posés ensuite sur `item.fields` (choicesFrom,
// crossTaskVisibility côté web…) restent pris en compte, la copie n'ayant lieu
// qu'à l'appel.
function _itemFn(base, build) {
  var fn = function (rowValue, index) {
    var o = typeof base === 'function' ? base(rowValue, index) : cloneDeepKeepFns(base || {});
    return build(o, rowValue, index) || o;
  };
  fn.fields = base && base.fields;
  return fn;
}

// Installe les règles dont la cible est dans un répétable. `acts[i].segs` =
// chemin de la cible coupé à chaque répétable (cf. _repeatSegments), `k` = segment
// suivant. Une condition sur un champ de la MÊME ligne est lue dans cette ligne
// (scopes) ; sur un autre champ de la page, au niveau de la page.
function _installRowRules(options, acts, values, allResponses, scopes, absPrefix) {
  if (!acts.length) return;
  var groups = {};
  acts.forEach(function (a) {
    var key = a.segs[a.k - 1];
    (groups[key] || (groups[key] = [])).push(a);
  });
  Object.keys(groups).forEach(function (rel) {
    var listNode = optionNodeAtPath(options, rel);
    var abs = absPrefix ? absPrefix + '.' + rel : rel;
    var mine = groups[rel];
    listNode.item = _itemFn(listNode.item, function (o, rowValue) {
      var sc = (scopes || []).concat([{ path: abs, row: rowValue || {} }]);
      var direct = [];
      var deeper = [];
      mine.forEach(function (a) {
        if (a.k === a.segs.length - 1) {
          direct.push({ target: a.segs[a.k], action: a.action, met: evaluateCondition(a.when, values, allResponses, sc) });
        } else {
          deeper.push({ when: a.when, action: a.action, segs: a.segs, k: a.k + 1 });
        }
      });
      _applyRuleActs(o, direct);
      _installRowRules(o, deeper, values, allResponses, sc, abs);
      return o;
    });
  });
}

/* ============================================ sources dynamiques / cascade */

// Résout un chemin de champ parent pour la cascade : `$n.` ou pointé -> tel
// quel ; sinon relatif au conteneur courant (prefix).
function _cascadePath(prefix, cascadeFrom) {
  if (!cascadeFrom) return null;
  // "/clé" : champ à la racine de la page (parent de cascade hors du groupe, générateur de formulaire)
  if (cascadeFrom.charAt(0) === '/') return cascadeFrom.slice(1);
  if (cascadeFrom.charAt(0) === '$' || cascadeFrom.indexOf('.') !== -1) return cascadeFrom;
  return prefix ? prefix + '.' + cascadeFrom : cascadeFrom;
}

// [{v,l,p}] -> [{value,text}] filtré par la valeur du champ parent (cascade).
function _datasetToOptions(node, values, allResponses, prefix) {
  var ds = Array.isArray(node.dataset) ? node.dataset : [];
  var pPath = _cascadePath(prefix, node.cascadeFrom);
  var list = ds;
  if (pPath) {
    var pv = resolveField(pPath, values, allResponses);
    if (isEmpty(pv)) return []; // parent non renseigné -> aucune option
    list = ds.filter(function (r) { return String(r.p) === String(pv); });
  }
  return list.map(function (r) {
    return { value: r.v, text: (r.l != null && r.l !== '') ? r.l : String(r.v) };
  });
}

// Pose `options` (et `item.options` pour un select multiple) sur chaque champ
// à `dataset`, en filtrant la cascade selon les valeurs courantes.
function applyDatasets(options, values, allResponses) {
  if (!options || !options.fields) return options;
  (function walk(fields, prefix) {
    Object.keys(fields).forEach(function (key) {
      var f = fields[key];
      if (!f || typeof f !== 'object') return;
      var path = prefix ? prefix + '.' + key : key;
      if (Array.isArray(f.dataset)) {
        var opts = _datasetToOptions(f, values, allResponses, prefix);
        f.options = opts;                       // select_one
        f.item = (f.item && typeof f.item === 'object') ? f.item : {};
        f.item.options = opts;                  // select_multiple (t.list d'items)
      }
      if (f.fields) walk(f.fields, path);
      if (f.item && f.item.fields) walk(f.item.fields, path);
    });
  })(options.fields, '');
  return options;
}

// Vide la valeur d'un champ cascade dont l'option n'existe plus (parent changé).
// Renvoie `values` inchangé si rien n'a bougé, sinon une COPIE modifiée.
function pruneStaleCascadeValues(options, values) {
  if (!options || !options.fields) return values;
  var out = null;
  (function walk(fields, prefix) {
    Object.keys(fields).forEach(function (key) {
      var f = fields[key];
      if (!f || typeof f !== 'object') return;
      var path = prefix ? prefix + '.' + key : key;
      if (Array.isArray(f.dataset) && Array.isArray(f.options)) {
        var cur = resolvePath(out || values, path);
        if (!isEmpty(cur) && !Array.isArray(cur)) {
          var ok = f.options.some(function (o) { return String(o.value) === String(cur); });
          if (!ok) {
            if (!out) out = cloneValue(values || {});
            setPath(out, path, undefined);
          }
        }
      }
      if (f.fields) walk(f.fields, path);
    });
  })(options.fields, '');
  return out || values;
}

/* ===================================================== obligatoires vides */

// `values` : réponses de la page — nécessaires pour parcourir les lignes d'un
// répétable (chemins « rep.<index>.champ »).
function collectRuleRequired(fields, prefix, acc, values) {
  Object.keys(fields || {}).forEach(function (key) {
    var f = fields[key] || {};
    if (f.hidden) return;
    var path = prefix ? prefix + '.' + key : key;
    if (f.__ruleRequired) acc.push(path);
    if (f.fields) collectRuleRequired(f.fields, path, acc, values);
    if (f.item) {
      var rows = resolvePath(values || {}, path);
      if (!Array.isArray(rows)) return;
      rows.forEach(function (row, i) {
        var io = typeof f.item === 'function' ? f.item(row, i) : f.item;
        if (io && io.fields) collectRuleRequired(io.fields, path + '.' + i, acc, values);
      });
    }
  });
  return acc;
}

/** Champs rendus obligatoires par une règle `require` et encore vides. */
function validateRuleRequired(dynamicOptions, values) {
  var paths = collectRuleRequired((dynamicOptions || {}).fields, '', [], values);
  return paths.filter(function (p) { return isEmpty(resolvePath(values || {}, p)); });
}

function walkSchemaRequired(objSchema, val, opts, prefix, missing) {
  var props = (objSchema && objSchema.properties) || {};
  var req = (objSchema && objSchema.required) || [];
  Object.keys(props).forEach(function (key) {
    var p = props[key] || {};
    var o = (opts && opts[key]) || {};
    var path = prefix ? prefix + '.' + key : key;
    if (o.hidden) return; // champ / groupe masqué -> obligations levées

    if (p.type === 'object') {
      // On descend TOUJOURS dans un groupe visible : ses enfants requis doivent
      // être renseignés même si le groupe n'est pas dans `required` (sinon tcomb
      // le traite comme t.maybe et « groupe entièrement vide » passe).
      walkSchemaRequired(p, (val && val[key]) || {}, o.fields || {}, path, missing);
    } else if (p.type === 'array' && p.items && p.items.type === 'object') {
      // Répétable : validation ligne par ligne hors périmètre v1.
    } else if (req.indexOf(key) !== -1) {
      if (isEmpty(val ? val[key] : undefined)) missing.push(path);
    }
  });
  return missing;
}

/** Champs `required` du JSON-schema (y compris dans un groupe visible) et vides. */
function validateSchemaRequired(page, values, dynamicOptions) {
  var schema = page && page.page;
  if (!schema || !schema.properties) return [];
  return walkSchemaRequired(
    schema, values || {}, (dynamicOptions || {}).fields || {}, '', []
  );
}

/**
 * Liste combinée des chemins obligatoires non satisfaits pour la page.
 * (règle `require` + schéma `required`). `[]` si la page n'a pas de logique
 * déclarative -> on laisse le comportement historique.
 */
function checkPageRequired(page, values, dynamicOptions) {
  if (!hasDeclarativeLogic(page)) return [];
  return validateRuleRequired(dynamicOptions, values)
    .concat(validateSchemaRequired(page, values, dynamicOptions));
}

/* ============================================== marquage visuel « en rouge » */

function _leafKey(path) {
  var p = String(path).split('.');
  return p[p.length - 1];
}

/**
 * Pose `hasError` (+ un message) sur les noeuds d'options correspondant à
 * `paths` -> tcomb-form-native rend alors ces champs EN ROUGE. Message : en
 * priorité `page.messages[<feuille>].required`, sinon `fallbackMsg`, sinon un
 * libellé générique. Mute `options` (qui est déjà un clone au moment de
 * l'appel, cf. buildDynamicOptions).
 */
function markRequiredErrors(options, paths, page, fallbackMsg) {
  if (!options || !Array.isArray(paths) || !paths.length) return options;
  var messages = (page && page.messages) || {};
  paths.forEach(function (p) {
    var perField = messages[_leafKey(p)] && messages[_leafKey(p)].required;
    _markError(options, String(p).split('.'), perField || fallbackMsg || 'Ce champ est obligatoire');
  });
  return options;
}

// « rep.2.champ » : l'erreur n'est posée que sur la ligne 2 (options de ligne
// calculées par `item`, cf. _itemFn).
function _markError(node, parts, msg) {
  for (var i = 0; i < parts.length; i++) {
    if (i > 0 && /^\d+$/.test(parts[i])) {
      var rest = parts.slice(i + 1);
      if (!rest.length) return;
      if (!node.item || !node.item.__cddRowErrors) {
        var marks = {};
        node.item = _itemFn(node.item, function (o, rowValue, index) {
          (marks[index] || []).forEach(function (m) { _markError(o, m.rest, m.msg); });
          return o;
        });
        node.item.__cddRowErrors = marks;
      }
      var idx = Number(parts[i]);
      (node.item.__cddRowErrors[idx] || (node.item.__cddRowErrors[idx] = [])).push({ rest: rest, msg: msg });
      return;
    }
    if (!node.fields) node.fields = {};
    if (!node.fields[parts[i]]) node.fields[parts[i]] = {};
    node = node.fields[parts[i]];
  }
  node.hasError = true;
  if (node.error == null) node.error = msg;
}

/* ============================================================== calculs */

var FUNCTIONS = {
  sum: function (a) { return a.reduce(function (x, y) { return x + y; }, 0); },
  min: function (a) { return a.length ? Math.min.apply(null, a) : 0; },
  max: function (a) { return a.length ? Math.max.apply(null, a) : 0; },
  round: function (a) { return Math.round(a[0] || 0); },
  abs: function (a) { return Math.abs(a[0] || 0); },
  floor: function (a) { return Math.floor(a[0] || 0); },
  ceil: function (a) { return Math.ceil(a[0] || 0); },
  int: function (a) { return parseInt(a[0] || 0, 10) || 0; },
  float: function (a) { return parseFloat(a[0] || 0) || 0; }
};

var BINOPS = {
  '+': function (a, b) { return a + b; },
  '-': function (a, b) { return a - b; },
  '*': function (a, b) { return a * b; },
  '/': function (a, b) { return b === 0 ? 0 : a / b; },
  '%': function (a, b) { return b === 0 ? 0 : a % b; }
};

function tokenize(expr) {
  var tokens = [];
  var re = /\s*([A-Za-z_][\w.]*|\d+\.\d+|\d+|[()+\-*/%,])\s*/g;
  var m;
  var last = 0;
  while ((m = re.exec(expr)) !== null) {
    if (m.index !== last) return null;
    tokens.push(m[1]);
    last = re.lastIndex;
  }
  return last === expr.length ? tokens : null;
}

function parse(tokens) {
  var i = 0;
  function peek() { return tokens[i]; }
  function next() { return tokens[i++]; }

  function parseExpr() {
    var node = parseTerm();
    while (peek() === '+' || peek() === '-') {
      node = { t: 'bin', op: next(), l: node, r: parseTerm() };
    }
    return node;
  }
  function parseTerm() {
    var node = parseFactor();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      node = { t: 'bin', op: next(), l: node, r: parseFactor() };
    }
    return node;
  }
  function parseFactor() {
    var tok = peek();
    if (tok === '-') { next(); return { t: 'neg', v: parseFactor() }; }
    if (tok === '+') { next(); return parseFactor(); }
    if (tok === '(') {
      next();
      var node = parseExpr();
      if (next() !== ')') throw new Error('paren');
      return node;
    }
    if (/^\d+(\.\d+)?$/.test(tok)) { next(); return { t: 'num', v: parseFloat(tok) }; }
    if (/^[A-Za-z_][\w.]*$/.test(tok)) {
      next();
      if (peek() === '(') {
        next();
        var args = [];
        if (peek() !== ')') {
          args.push(parseExpr());
          while (peek() === ',') { next(); args.push(parseExpr()); }
        }
        if (next() !== ')') throw new Error('paren');
        return { t: 'call', name: tok, args: args };
      }
      return { t: 'var', name: tok };
    }
    throw new Error('token ' + tok);
  }

  var ast = parseExpr();
  if (i !== tokens.length) throw new Error('trailing');
  return ast;
}

function numValue(v) {
  if (typeof v === 'number') return v;
  if (v == null || v === '') return 0;
  var n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// Valeur au chemin `path` sous `root`. Un groupe répétable traversé renvoie la
// COLONNE : tableau des valeurs de toutes ses lignes (aplati si imbriqué).
function _column(root, path) {
  var info = _columnInfo(root, path);
  return info.value;
}
function _columnInfo(root, path) {
  var parts = String(path).split('.');
  var cur = [root];
  var multi = false;
  for (var i = 0; i < parts.length; i++) {
    var next = [];
    for (var j = 0; j < cur.length; j++) {
      var c = cur[j];
      if (c == null) continue;
      if (Array.isArray(c)) {
        multi = true;
        for (var r = 0; r < c.length; r++) if (c[r] != null) next.push(c[r][parts[i]]);
      } else {
        next.push(c[parts[i]]);
      }
    }
    cur = next;
  }
  return { multi: multi, value: multi ? cur : cur[0] };
}

// Résolution des variables d'une expression. `scopes` = lignes de répétable en
// cours ([{path:"rep", row:{...}}], de l'extérieur vers l'intérieur) : une
// variable du même répétable que la cible est lue dans LA ligne calculée ;
// sinon elle est lue dans la page (colonne entière si elle traverse un répétable).
function _calcLookup(pageValues, scopes) {
  return function (name) {
    for (var s = scopes.length - 1; s >= 0; s--) {
      var pre = scopes[s].path + '.';
      if (name.indexOf(pre) === 0) return _column(scopes[s].row, name.slice(pre.length));
    }
    return _column(pageValues, name);
  };
}

// `lookup` : fonction (cf. _calcLookup) ou objet de valeurs (ancien contrat).
// Une colonne de répétable vaut sa SOMME dans une opération, et est étalée en
// arguments dans une fonction : sum(rep.x), min(rep.x), max(rep.x).
function evalNode(node, lookup) {
  if (typeof lookup !== 'function') lookup = _calcLookup(lookup || {}, []);
  switch (node.t) {
    case 'num': return node.v;
    case 'var': {
      var v = lookup(node.name);
      return Array.isArray(v) ? FUNCTIONS.sum(v.map(numValue)) : numValue(v);
    }
    case 'neg': return -evalNode(node.v, lookup);
    case 'bin': return BINOPS[node.op](evalNode(node.l, lookup), evalNode(node.r, lookup));
    case 'call': {
      var fn = FUNCTIONS[node.name];
      if (!fn) return 0;
      var args = [];
      node.args.forEach(function (a) {
        if (a.t === 'var') {
          var av = lookup(a.name);
          if (Array.isArray(av)) { av.forEach(function (x) { args.push(numValue(x)); }); return; }
          args.push(numValue(av));
          return;
        }
        args.push(evalNode(a, lookup));
      });
      return fn(args);
    }
    default: return 0;
  }
}

// "grp.rep.sous.total" -> ["grp.rep", "sous", "total"] : chemin coupé après
// chaque groupe répétable (selon le schéma de la page).
function _repeatSegments(page, path) {
  var schema = page && page.page;
  var parts = String(path).split('.');
  var segs = [];
  var cur = [];
  for (var i = 0; i < parts.length; i++) {
    cur.push(parts[i]);
    schema = schema && schema.properties ? schema.properties[parts[i]] : null;
    if (i < parts.length - 1 && schema && schema.type === 'array' &&
        schema.items && schema.items.type === 'object') {
      segs.push(cur.join('.'));
      cur = [];
      schema = schema.items;
    }
  }
  segs.push(cur.join('.'));
  return segs;
}

// Nœud d'options d'un chemin, en passant par `item` à chaque répétable
// (options d'une ligne de `t.list`), et non par `fields` comme un groupe.
function optionNodeAtSchemaPath(page, options, path) {
  var segs = _repeatSegments(page, path);
  var node = options;
  for (var i = 0; i < segs.length; i++) {
    node = optionNodeAtPath(node, segs[i]);
    if (i < segs.length - 1) {
      if (!node.item || typeof node.item !== 'object') node.item = {};
      node = node.item;
    }
  }
  return node;
}

// Calcule une cible dans `obj` (mutation). Cible dans un répétable : calculée
// ligne par ligne. Renvoie true si une valeur a changé.
function _calcInto(obj, segs, k, absPrefix, scopes, pageValues, ast) {
  if (k === segs.length - 1) {
    var res = evalNode(ast, _calcLookup(pageValues, scopes));
    if (res == null || isNaN(res) || !isFinite(res)) return false;
    var rounded = Math.round(res * 1e6) / 1e6;
    if (numValue(resolvePath(obj, segs[k])) === rounded) return false;
    setPath(obj, segs[k], rounded);
    return true;
  }
  var list = resolvePath(obj, segs[k]);
  if (!Array.isArray(list)) return false;
  var abs = absPrefix ? absPrefix + '.' + segs[k] : segs[k];
  var changed = false;
  for (var i = 0; i < list.length; i++) {
    // ligne tout juste ajoutée (« + Ajouter » pousse `undefined`)
    if (list[i] == null || typeof list[i] !== 'object') list[i] = {};
    if (_calcInto(list[i], segs, k + 1, abs, scopes.concat([{ path: abs, row: list[i] }]), pageValues, ast)) {
      changed = true;
    }
  }
  return changed;
}

var _astCache = {};
function compileExpr(expr) {
  if (Object.prototype.hasOwnProperty.call(_astCache, expr)) return _astCache[expr];
  var ast = null;
  try {
    var tokens = tokenize(expr);
    if (tokens) ast = parse(tokens);
  } catch (e) {
    ast = null;
  }
  _astCache[expr] = ast;
  return ast;
}

/**
 * COPIE de `values` avec les cibles de `page.calculate` recalculées.
 * Groupes répétables : une cible « rep.total » est calculée sur CHAQUE ligne, à
 * partir des champs de cette même ligne (« rep.qte * rep.prix ») ; une cible
 * hors répétable qui lit « rep.x » reçoit la somme de la colonne.
 */
function applyCalculations(page, values) {
  if (!page || !Array.isArray(page.calculate) || !page.calculate.length) return values;
  var out = cloneValue(values || {});
  var items = page.calculate.filter(function (c) { return c && c.target && c.expr; });
  var passes = Math.min(Math.max(items.length, 1), 6);
  for (var p = 0; p < passes; p++) {
    var changed = false;
    for (var k = 0; k < items.length; k++) {
      var ast = compileExpr(items[k].expr);
      if (!ast) continue;
      if (_calcInto(out, _repeatSegments(page, items[k].target), 0, '', [], out, ast)) changed = true;
    }
    if (!changed) break;
  }
  return out;
}

function calculatedTargets(page) {
  if (!page || !Array.isArray(page.calculate)) return [];
  return page.calculate
    .filter(function (c) { return c && c.target; })
    .map(function (c) { return c.target; });
}

/* ============================================== remplissage automatique */

// `page.autofill = [{ source, rows: [{k, d: {colonne: valeur}}], targets: [{path, column, editable}] }]`,
// porté par la page des CIBLES. Quand la valeur du champ `source` change, chaque cible reçoit la valeur
// de sa colonne dans la ligne dont la clé `k` vaut cette valeur (vide si aucune ligne).
//  - `source` sur une AUTRE page : "$<index>.<chemin>" (lu dans toutes les réponses) ;
//  - groupe répétable : source et cibles dans le MÊME répétable ("rep.champ"), appliqué ligne par ligne ;
//    source HORS répétable : une cible dans un répétable est remplie sur toutes ses lignes ;
//  - cible `editable: false` = verrouillée : toujours recalculée et affichée désactivée ;
//  - cible modifiable : réécrite seulement quand la source change (la saisie est conservée).
function autofillItems(page) {
  if (!page || !Array.isArray(page.autofill)) return [];
  return page.autofill.filter(function (a) {
    return a && a.source && Array.isArray(a.rows) && Array.isArray(a.targets);
  });
}

function _autofillKey(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.length ? _autofillKey(v[0]) : '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  if (typeof v === 'object') return '';
  return String(v).trim();
}

// Index des lignes par clé (calculé une fois par entrée).
function _autofillRow(item, key) {
  if (key === '') return null;
  if (!item.__index) {
    var exact = {}, lower = {};
    (item.rows || []).forEach(function (r) {
      var k = String(r.k).trim();
      if (!(k in exact)) exact[k] = r;
      if (!(k.toLowerCase() in lower)) lower[k.toLowerCase()] = r;
    });
    Object.defineProperty(item, '__index', { value: { exact: exact, lower: lower }, enumerable: false });
  }
  return item.__index.exact[key] || item.__index.lower[key.toLowerCase()] || null;
}

function _schemaAtPath(page, path) {
  var schema = page && page.page;
  var parts = String(path).split('.');
  for (var i = 0; i < parts.length; i++) {
    if (schema && schema.type === 'array' && schema.items) schema = schema.items;
    if (!schema || !schema.properties) return null;
    schema = schema.properties[parts[i]];
  }
  return schema || null;
}

// "rep.champ" -> { list: "rep", inner: "champ" } si le chemin traverse un groupe répétable.
function _repeatSplit(page, path) {
  var schema = page && page.page, parts = String(path).split('.');
  for (var i = 0; i < parts.length - 1; i++) {
    if (!schema || !schema.properties) return null;
    schema = schema.properties[parts[i]];
    if (schema && schema.type === 'array') {
      return { list: parts.slice(0, i + 1).join('.'), inner: parts.slice(i + 1).join('.') };
    }
  }
  return null;
}

// "27/10/2026", "2026-10-27", "2026-10-27 08:30:00" -> Date (ou null)
function _autofillDate(raw) {
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  var s = String(raw).trim(), m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  var d = m
    ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0))
    : new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00.000Z' : s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

// Valeur de la table -> valeur du champ cible selon son type (undefined si inutilisable).
function _autofillValue(raw, schema, dateAsObject) {
  if (raw == null || raw === '') return undefined;
  var tp = schema && schema.type;
  if (tp === 'integer' || tp === 'number') {
    var n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.').replace(/\s/g, ''));
    if (isNaN(n)) return undefined;
    return tp === 'integer' ? Math.round(n) : n;
  }
  if (tp === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    var b = String(raw).trim().toLowerCase();
    if (['1', 'true', 'vrai', 'oui', 'yes', 'o', 'y'].indexOf(b) !== -1) return true;
    if (['0', 'false', 'faux', 'non', 'no', 'n'].indexOf(b) !== -1) return false;
    return undefined;
  }
  var fmt = schema && schema.format;
  if (fmt === 'date' || fmt === 'datetime' || fmt === 'time') {
    var d = _autofillDate(raw);
    if (!d) return undefined;
    return dateAsObject ? d : d.toISOString();
  }
  if (schema && Array.isArray(schema.enum)) {
    var sv = String(raw).trim();
    return schema.enum.map(String).indexOf(sv) !== -1 ? sv : undefined;
  }
  if (schema && schema.enum && typeof schema.enum === 'object') {
    var key = String(raw).trim();
    return Object.prototype.hasOwnProperty.call(schema.enum, key) ? key : undefined;
  }
  return String(raw);
}

function _sameValue(a, b) {
  if (a instanceof Date || b instanceof Date) {
    var ta = a instanceof Date ? a.getTime() : (a ? new Date(a).getTime() : NaN);
    var tb = b instanceof Date ? b.getTime() : (b ? new Date(b).getTime() : NaN);
    return (isNaN(ta) && isNaN(tb)) || ta === tb;
  }
  if ((a == null || a === '') && (b == null || b === '')) return true;
  return a === b;
}

// Mise à jour sans effet de bord : copie seulement les objets le long du chemin.
function _setPathCopy(root, path, value) {
  var parts = String(path).split('.');
  var top = Object.assign({}, root), cur = top;
  for (var k = 0; k < parts.length - 1; k++) {
    var child = cur[parts[k]];
    cur[parts[k]] = child && typeof child === 'object' && !Array.isArray(child) ? Object.assign({}, child) : {};
    cur = cur[parts[k]];
  }
  cur[parts[parts.length - 1]] = value;
  return top;
}

// Une cible dans `obj` (chemin `path`) selon le mode (cf. _applyTargets).
function _applyOne(page, t, obj, path, row, mode, dateAsObject) {
  var locked = t.editable === false;
  var cur = resolvePath(obj || {}, path);
  if (!locked) {
    if (mode === 'same') return obj;
    if (mode === 'unknown' && (!row || !isEmpty(cur))) return obj;
  }
  var next = row ? _autofillValue((row.d || {})[t.column], _schemaAtPath(page, t.path), dateAsObject) : undefined;
  if (_sameValue(cur, next)) return obj;
  return _setPathCopy(obj || {}, path, next);
}

/**
 * Applique les cibles d'une entrée à `obj` (la page, ou une ligne de répétable via `innerOf`).
 * mode : "changed" (source modifiée : tout réécrire), "unknown" (état précédent inconnu :
 * cibles modifiables remplies seulement si vides), "same" (seules les verrouillées).
 * Déclencheur HORS répétable et cible DANS un répétable : la cible est remplie sur chaque
 * ligne ; une ligne ajoutée depuis `prevObj` est traitée en "unknown" (remplie si vide).
 */
function _applyTargets(page, item, obj, key, mode, dateAsObject, innerOf, prevObj) {
  var row = _autofillRow(item, key), out = obj;
  item.targets.forEach(function (t) {
    if (!t || !t.path || !t.column) return;
    if (innerOf) {
      var inner = innerOf(t.path);
      if (inner) out = _applyOne(page, t, out, inner, row, mode, dateAsObject);
      return;
    }
    var split = _repeatSplit(page, t.path);
    if (!split) {
      out = _applyOne(page, t, out, t.path, row, mode, dateAsObject);
      return;
    }
    var list = resolvePath(out || {}, split.list);
    if (!Array.isArray(list) || !list.length) return;
    var prevList = prevObj ? resolvePath(prevObj, split.list) : null;
    var newList = null;
    list.forEach(function (rowVal, i) {
      var rowMode = mode;
      if (mode === 'same' && prevObj && (!Array.isArray(prevList) || i >= prevList.length)) rowMode = 'unknown';
      var updated = _applyOne(page, t, rowVal || {}, split.inner, row, rowMode, dateAsObject);
      if (updated !== (rowVal || {})) {
        if (!newList) newList = list.slice();
        newList[i] = updated;
      }
    });
    if (newList) out = _setPathCopy(out || {}, split.list, newList);
  });
  return out;
}

/**
 * COPIE de `values` avec les champs remplis automatiquement.
 * `prevValues` : valeurs avant le changement (null au rendu : seules les cibles verrouillées sont
 * recalculées pour une source de la même page). `dateAsObject` : true sur mobile (objets Date),
 * false sur le web (chaînes ISO). `ctx` : { allResponses, memo } — `memo` (objet gardé par l'écran)
 * retient la dernière clé appliquée pour une source d'une autre page.
 */
function applyAutofill(page, prevValues, values, dateAsObject, ctx) {
  var items = autofillItems(page);
  if (!items.length) return values;
  ctx = ctx || {};
  var out = values || {};
  items.forEach(function (item, idx) {
    // 1) source sur une autre page
    if (item.source.charAt(0) === '$') {
      var key = _autofillKey(resolveField(item.source, out, ctx.allResponses));
      var memo = ctx.memo, mk = item.source + '>' + item.targets.map(function (t) { return t && t.path; }).join(',');
      var mode = memo && Object.prototype.hasOwnProperty.call(memo, mk)
        ? (memo[mk] !== key ? 'changed' : 'same') : 'unknown';
      if (memo) memo[mk] = key;
      out = _applyTargets(page, item, out, key, mode, dateAsObject, null, prevValues);
      return;
    }
    // 2) groupe répétable : ligne par ligne
    var split = _repeatSplit(page, item.source);
    if (split) {
      var list = resolvePath(out, split.list);
      if (!Array.isArray(list) || !list.length) return;
      var prevList = prevValues ? resolvePath(prevValues, split.list) : null;
      var prefix = split.list + '.';
      var innerOf = function (p) { return p.indexOf(prefix) === 0 ? p.slice(prefix.length) : null; };
      var newList = null;
      list.forEach(function (rowVal, i) {
        var k = _autofillKey(resolvePath(rowVal || {}, split.inner));
        var m = 'same';
        if (prevValues) {
          var prevRow = Array.isArray(prevList) ? prevList[i] : undefined;
          if (_autofillKey(resolvePath(prevRow || {}, split.inner)) !== k) m = 'changed';
        }
        var updated = _applyTargets(page, item, rowVal || {}, k, m, dateAsObject, innerOf);
        if (updated !== (rowVal || {})) {
          if (!newList) newList = list.slice();
          newList[i] = updated;
        }
      });
      if (newList) out = _setPathCopy(out, split.list, newList);
      return;
    }
    // 3) même page
    var k2 = _autofillKey(resolvePath(out, item.source));
    var m2 = prevValues != null && k2 !== _autofillKey(resolvePath(prevValues, item.source)) ? 'changed' : 'same';
    out = _applyTargets(page, item, out, k2, m2, dateAsObject, null, prevValues);
  });
  return out === (values || {}) ? values : out;
}

/** Désactive à l'affichage les cibles verrouillées (répétables compris). */
function markAutofillLocked(page, options) {
  autofillItems(page).forEach(function (item) {
    item.targets.forEach(function (t) {
      if (!t || !t.path || t.editable !== false) return;
      var split = _repeatSplit(page, t.path), node;
      if (split) {
        var listNode = optionNodeAtPath(options, split.list);
        listNode.item = listNode.item || {};
        node = optionNodeAtPath(listNode.item, split.inner);
      } else {
        node = optionNodeAtPath(options, t.path);
      }
      node.editable = false;
      node.disabled = true;
    });
  });
}

/** Chemins des cibles verrouillées. */
function autofillLockedTargets(page) {
  var acc = [];
  autofillItems(page).forEach(function (item) {
    item.targets.forEach(function (t) {
      if (t && t.path && t.editable === false && acc.indexOf(t.path) === -1) acc.push(t.path);
    });
  });
  return acc;
}

/* ================================================================ export */

module.exports = {
  hasDeclarativeLogic: hasDeclarativeLogic,
  hasDynamicOptions: hasDynamicOptions,
  evaluateCondition: evaluateCondition,
  buildDynamicOptions: buildDynamicOptions,
  applyDatasets: applyDatasets,
  pruneStaleCascadeValues: pruneStaleCascadeValues,
  validateRuleRequired: validateRuleRequired,
  validateSchemaRequired: validateSchemaRequired,
  checkPageRequired: checkPageRequired,
  markRequiredErrors: markRequiredErrors,
  applyCalculations: applyCalculations,
  calculatedTargets: calculatedTargets,
  applyAutofill: applyAutofill,
  autofillLockedTargets: autofillLockedTargets,
  markAutofillLocked: markAutofillLocked,
  cloneDeepKeepFns: cloneDeepKeepFns,
  coerceValueToSchema: coerceValueToSchema,
  applyDateModes: applyDateModes,
  applyRepeatBounds: applyRepeatBounds,
  applyNoteFields: applyNoteFields,
  optionNodeAtSchemaPath: optionNodeAtSchemaPath,
  cloneValue: cloneValue,
  resolvePath: resolvePath,
  isEmpty: isEmpty
};
