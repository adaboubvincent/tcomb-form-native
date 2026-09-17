// CDD : iOS utilise désormais le même rendu que Android — `CustomPickerModal`
// (modal + champ de recherche + FlatList virtualisée au-delà de
// `locals.listThreshold`) — au lieu de la roue `@react-native-picker/picker`,
// qui n'a pas de recherche et monte tous les items d'un coup.
var React = require("react");
var { View, Text } = require("react-native");
var core = require("../../components");

var CustomPickerModal = core.CustomPickerModal;

function select(locals) {
  if (locals.hidden) {
    return null;
  }

  var stylesheet = locals.stylesheet;
  var formGroupStyle = stylesheet.formGroup.normal;
  var controlLabelStyle = stylesheet.controlLabel.normal;
  var selectStyle = Object.assign(
    {},
    stylesheet.select.normal,
    stylesheet.pickerContainer.normal
  );
  var helpBlockStyle = stylesheet.helpBlock.normal;
  var errorBlockStyle = stylesheet.errorBlock;

  if (locals.hasError) {
    formGroupStyle = stylesheet.formGroup.error;
    controlLabelStyle = stylesheet.controlLabel.error;
    selectStyle = stylesheet.select.error;
    helpBlockStyle = stylesheet.helpBlock.error;
  }

  var label = locals.label ? (
    <Text style={controlLabelStyle}>{locals.label}</Text>
  ) : null;
  var help = locals.help ? (
    <Text style={helpBlockStyle}>{locals.help}</Text>
  ) : null;
  var error =
    locals.hasError && locals.error ? (
      <Text accessibilityLiveRegion="polite" style={errorBlockStyle}>
        {locals.error}
      </Text>
    ) : null;

  return (
    <CustomPickerModal
      locals={locals}
      selectStyle={selectStyle}
      formGroupStyle={formGroupStyle}
      help={help}
      error={error}
      label={label}
    />
  );
}

module.exports = select;
