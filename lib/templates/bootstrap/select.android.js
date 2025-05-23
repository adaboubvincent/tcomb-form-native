var React = require("react");
var { View, Text } = require("react-native");
var { Picker } = require("@react-native-picker/picker");
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

  /*var options = locals.options.map(({ value, text }) => (
    <Picker.Item key={value} value={value} label={text} style={locals.itemStyle} />
  ));

  return (
    <View style={formGroupStyle}>
      {label}
      <Picker
        accessibilityLabel={locals.label}
        ref="input"
        style={selectStyle}
        selectedValue={locals.value}
        onValueChange={locals.onChange}
        help={locals.help}
        enabled={!locals.disabled}
        mode={locals.mode}
        prompt={locals.prompt}
        itemStyle={locals.itemStyle}
      >
        {options}
      </Picker>
      {help}
      {error}
    </View>
  ); */
  return <CustomPickerModal 
    locals={locals} selectStyle={selectStyle} formGroupStyle={formGroupStyle} 
    help={help} error={error} label={label}
  />
}

module.exports = select;
