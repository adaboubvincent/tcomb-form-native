import t, { mixin } from "tcomb-validation";
import moment from 'moment';

export function getOptionsOfEnum(type) {
  const enums = type.meta.map;
  return Object.keys(enums).map(value => {
    return {
      value,
      text: enums[value]
    };
  });
}

export function getTypeInfo(type) {
  let innerType = type;
  let isMaybe = false;
  let isSubtype = false;
  let kind;
  let innerGetValidationErrorMessage;

  while (innerType) {
    kind = innerType.meta.kind;
    if (t.Function.is(innerType.getValidationErrorMessage)) {
      innerGetValidationErrorMessage = innerType.getValidationErrorMessage;
    }
    if (kind === "maybe") {
      isMaybe = true;
      innerType = innerType.meta.type;
      continue;
    }
    if (kind === "subtype") {
      isSubtype = true;
      innerType = innerType.meta.type;
      continue;
    }
    break;
  }

  const getValidationErrorMessage = innerGetValidationErrorMessage
    ? (value, path, context) => {
        const result = t.validate(value, type, { path, context });
        if (!result.isValid()) {
          for (let i = 0, len = result.errors.length; i < len; i++) {
            if (
              t.Function.is(result.errors[i].expected.getValidationErrorMessage)
            ) {
              return result.errors[i].message;
            }
          }
          return innerGetValidationErrorMessage(value, path, context);
        }
      }
    : undefined;

  return {
    type,
    isMaybe,
    isSubtype,
    innerType,
    getValidationErrorMessage
  };
}

// thanks to https://github.com/epeli/underscore.string

function underscored(s) {
  return s
    .trim()
    .replace(/([a-z\d])([A-Z]+)/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function humanize(s) {
  return capitalize(
    underscored(s)
      .replace(/_id$/, "")
      .replace(/_/g, " ")
  );
}

export function merge(a, b) {
  return mixin(mixin({}, a), b, true);
}

export function move(arr, fromIndex, toIndex) {
  const element = arr.splice(fromIndex, 1)[0];
  arr.splice(toIndex, 0, element);
  return arr;
}

export class UIDGenerator {
  constructor(seed) {
    this.seed = "tfid-" + seed + "-";
    this.counter = 0;
  }

  next() {
    return this.seed + this.counter++; // eslint-disable-line space-unary-ops
  }
}

function containsUnion(type) {
  switch (type.meta.kind) {
    case "union":
      return true;
    case "maybe":
    case "subtype":
      return containsUnion(type.meta.type);
    default:
      return false;
  }
}

function getUnionConcreteType(type, value) {
  const kind = type.meta.kind;
  if (kind === "union") {
    const concreteType = type.dispatch(value);
    if (process.env.NODE_ENV !== "production") {
      t.assert(
        t.isType(concreteType),
        () =>
          "Invalid value " +
          t.assert.stringify(value) +
          " supplied to " +
          t.getTypeName(type) +
          " (no constructor returned by dispatch)"
      );
    }
    return concreteType;
  } else if (kind === "maybe") {
    return t.maybe(getUnionConcreteType(type.meta.type, value), type.meta.name);
  } else if (kind === "subtype") {
    return t.subtype(
      getUnionConcreteType(type.meta.type, value),
      type.meta.predicate,
      type.meta.name
    );
  }
}

export function getTypeFromUnion(type, value) {
  if (containsUnion(type)) {
    return getUnionConcreteType(type, value);
  }
  return type;
}

function getUnion(type) {
  if (type.meta.kind === "union") {
    return type;
  }
  return getUnion(type.meta.type);
}

function findIndex(arr, element) {
  for (let i = 0, len = arr.length; i < len; i++) {
    if (arr[i] === element) {
      return i;
    }
  }
  return -1;
}

export function getComponentOptions(options, defaultOptions, value, type) {
  if (t.Nil.is(options)) {
    return defaultOptions;
  }
  if (t.Function.is(options)) {
    return options(value);
  }
  if (t.Array.is(options) && containsUnion(type)) {
    const union = getUnion(type);
    const concreteType = union.dispatch(value);
    const index = findIndex(union.meta.types, concreteType);
    // recurse
    return getComponentOptions(
      options[index],
      defaultOptions,
      value,
      concreteType
    );
  }
  return options;
}


export function autoParseDate(dateStr) {
  // const patterns = [
  //   { regex: /^\d{4}-\d{2}-\d{2}$/, parser: (s) => new Date(s) }, // yyyy-mm-dd
  //   { regex: /^\d{2}-\d{2}-\d{4}$/, parser: (s) => {
  //       const [d, m, y] = s.split('-');
  //       return new Date(`${y}-${m}-${d}`);
  //   }},
  //   { regex: /^\d{2}\/\d{2}\/\d{4}$/, parser: (s) => {
  //       const [m, d, y] = s.split('/');
  //       return new Date(`${y}-${m}-${d}`);
  //   }},
  //   { regex: /^\d{4}\/\d{2}\/\d{2}$/, parser: (s) => {
  //       return new Date(s.replace(/\//g, '-'));
  //   }},
  //   { regex: /^\d{4}-\d{2}$/, parser: (s) => {
  //       return new Date(`${s}-01`);
  //   }},
  // ];

  // for (const { regex, parser } of patterns) {
  //   if (regex.test(dateStr)) {
  //     const parsed = parser(dateStr);
  //     if (!isNaN(parsed)) return parsed;
  //   }
  // }

  // return null;

  const datetimeFormats = [
    'YYYY-MM-DD HH:mm:ss',
    'YYYY-M-D H:m:s',
    'YYYY-MM-DD H:m:s',
    'YYYY-M-D HH:mm:ss',
    
    'YYYY-MM-DD HH:mm',
    'YYYY-M-D H:m',
    'YYYY-MM-DD H:m',
    'YYYY-M-D HH:mm',
    
    'DD-MM-YYYY HH:mm:ss',
    'D-M-YYYY H:m:s',
    'DD-MM-YYYY H:m:s',
    'D-M-YYYY HH:mm:ss',
  
    'DD-MM-YYYY HH:mm',
    'D-M-YYYY H:m',
    'DD-MM-YYYY H:m',
    'D-M-YYYY HH:mm',
  
    'DD/MM/YYYY HH:mm:ss',
    'D/M/YYYY H:m:s',
    'DD/MM/YYYY H:m:s',
    'D/M/YYYY HH:mm:ss',
  
    'DD/MM/YYYY HH:mm',
    'D/M/YYYY H:m',
    'DD/MM/YYYY H:m',
    'D/M/YYYY HH:mm',
  
    'YYYY/MM/DD HH:mm:ss',
    'YYYY/M/D H:m:s',
    'YYYY/MM/DD H:m:s',
    'YYYY/M/D HH:mm:ss',
  
    'YYYY/MM/DD HH:mm',
    'YYYY/M/D H:m',
    'YYYY/MM/DD H:m',
    'YYYY/M/D HH:mm',
  
    'YYYY-MM-DDTHH:mm:ss',
    'YYYY-MM-DDTHH:mm',
    'YYYY-MM-DDTHH:mm:ssZ',
    'YYYY-MM-DDTHH:mm:ss.SSSZ',
  ];
  
  const dateFormats = [
    'YYYY-MM-DD',
    'YYYY-M-D',
    'DD-MM-YYYY',
    'D-M-YYYY',
    'DD/MM/YYYY',
    'D/M/YYYY',
    'YYYY/MM/DD',
    'YYYY/M/D',
    'MM/DD/YYYY',
    'M/D/YYYY',
    'DD.MM.YYYY',
    'D.M.YYYY',
    'YYYY-MM',
    'YYYY-M',
    'YYYY/MM',
    'YYYY/M',
    'YYYYMMDD',
  ];
  
  const timeFormats = [
    'HH:mm:ss',
    'H:m:s',
    'HH:mm',
    'H:m',
  ];

  for (const format of datetimeFormats) {
    const parsed = moment(dateStr, format, true);
    if (parsed.isValid()) return parsed.toDate();
  }

  for (const format of dateFormats) {
    const parsed = moment(dateStr, format, true);
    if (parsed.isValid()) return parsed.toDate();
  }

  for (const format of timeFormats) {
    const parsed = moment(dateStr, format, true);
    if (parsed.isValid()) return parsed.toDate();
  }

  return null;

}


export function formatNumberWithSpaces(text, keyboard_type=null) {
  
  if (keyboard_type === "numeric") {
    const cleaned = text.replace(/[^0-9.]/g, '');

    const [integerPart, decimalPart] = cleaned.split('.');

    const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

    return decimalPart !== undefined
      ? `${formattedInteger}.${decimalPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
      : formattedInteger;
  }

  return text;

};