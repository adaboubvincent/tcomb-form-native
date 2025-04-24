import React from "react";
import { View, Text, TouchableNativeFeedback, TouchableOpacity, Platform } from "react-native";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { autoParseDate } from "../../util";
var core = require("../../components");

var CustomDateTimePickerModal = core.CustomDateTimePickerModal;


function datepicker(locals) {
  if (locals.hidden) {
    return null;
  }

  var stylesheet = locals.stylesheet;
  var formGroupStyle = stylesheet.formGroup.normal;
  var controlLabelStyle = stylesheet.controlLabel.normal;
  var datepickerStyle = stylesheet.datepicker.normal;
  var helpBlockStyle = stylesheet.helpBlock.normal;
  var errorBlockStyle = stylesheet.errorBlock;
  var dateValueStyle = stylesheet.dateValue.normal;

  if (locals.hasError) {
    formGroupStyle = stylesheet.formGroup.error;
    controlLabelStyle = stylesheet.controlLabel.error;
    datepickerStyle = stylesheet.datepicker.error;
    helpBlockStyle = stylesheet.helpBlock.error;
    dateValueStyle = stylesheet.dateValue.error;
  }

  // Setup the picker mode
  var datePickerMode = locals.mode;
  if (
    datePickerMode !== "date" &&
    datePickerMode !== "time" &&
    datePickerMode !== "datetime"
  ) {
    throw new Error(`Unrecognized date picker format ${datePickerMode}`);
  }

   
   if (locals.value && typeof locals.value === 'string') {
    const parsed  = autoParseDate(locals.value);
    if (parsed) locals.value = parsed;
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
      <CustomDateTimePickerModal
        locals={locals}
        datepickerStyle={datepickerStyle}
        formGroupStyle={formGroupStyle}
        help={help}
        error={error}
        label={label}
      />
    );
}

module.exports = datepicker;
