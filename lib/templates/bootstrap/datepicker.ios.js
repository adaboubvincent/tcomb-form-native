import React from "react";
import PropTypes from "prop-types";
import { Text, View, Animated, TouchableOpacity } from "react-native";
import DatePickerIOS from "@react-native-community/datetimepicker";
import { autoParseDate } from "../../util";

const UIPICKER_HEIGHT = 216;

// Convertit une valeur quelconque en Date valide, sinon null. Les chaines sont
// validees via autoParseDate (formats stricts moment) : jours/mois hors limites
// ("33-05-2022", "05-13-2022", "31-02-2024") et texte libre => null. Evite que
// .toDateString()/.toISOString() ne fasse planter l'app.
function toValidDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (typeof value === "string") {
    const parsed = autoParseDate(value.trim());
    return parsed && !isNaN(parsed.getTime()) ? parsed : null;
  }
  return null;
}

class CollapsibleDatePickerIOS extends React.Component {
  constructor(props) {
    super(props);
    this._onDateChange = this.onDateChange.bind(this);
    this._onPress = this.onPress.bind(this);
    this.state = {
      isCollapsed: true,
      height: new Animated.Value(0)
    };
  }

  onDateChange(_, value) {
    this.props.locals.onChange(value);
  }

  onPress() {
    const locals = this.props.locals;
    let animation = Animated.timing;
    let animationConfig = {
      duration: 200
    };
    if (locals.config) {
      if (locals.config.animation) {
        animation = locals.config.animation;
      }
      if (locals.config.animationConfig) {
        animationConfig = locals.config.animationConfig;
      }
    }
    animation(
      this.state.height,
      Object.assign(
        {
          toValue: this.state.isCollapsed ? UIPICKER_HEIGHT : 0
        },
        animationConfig
      )
    ).start();
    this.setState({ isCollapsed: !this.state.isCollapsed });
    if (typeof locals.onPress === "function") {
      locals.onPress();
    }
  }

  render() {
    const locals = this.props.locals;
    const stylesheet = locals.stylesheet;
    let touchableStyle = stylesheet.dateTouchable.normal;
    let datepickerStyle = stylesheet.datepicker.normal;
    let dateValueStyle = stylesheet.dateValue.normal;
    if (locals.hasError) {
      touchableStyle = stylesheet.dateTouchable.error;
      datepickerStyle = stylesheet.datepicker.error;
      dateValueStyle = stylesheet.dateValue.error;
    }

    if (locals.disabled) {
      touchableStyle = stylesheet.dateTouchable.notEditable;
    }

    // Date valide -> objet Date. Valeur presente mais invalide -> on garde la
    // valeur brute pour l'afficher en rouge sous le champ, sans jamais la
    // transmettre au calendrier natif (qui planterait). Champ affiche vide.
    const validValue = toValidDate(locals.value);
    const invalidRawValue =
      locals.value && !validValue
        ? (typeof locals.value === "string" ? locals.value : String(locals.value))
        : null;
    const expectedDateFormat =
      locals.mode === "date"
        ? "DD-MM-YYYY"
        : locals.mode === "time"
          ? "HH:mm"
          : "DD-MM-YYYY HH:mm";

    let formattedValue = validValue
      ? locals.mode === "date"
        ? validValue.toDateString()
        : locals.mode === "time"
          ? validValue.toTimeString()
          : validValue.toISOString()
      : "";
    if (!formattedValue) {
      formattedValue =
        locals.config && locals.config.defaultValueText
          ? locals.config.defaultValueText
          : `Tap here to select a ${locals.mode}`;
    }
    const height = this.state.isCollapsed ? 0 : UIPICKER_HEIGHT;
    return (
      <View>
        <TouchableOpacity
          style={touchableStyle}
          disabled={locals.disabled}
          onPress={this._onPress}
        >
          <Text style={dateValueStyle}>{formattedValue}</Text>
        </TouchableOpacity>
        {invalidRawValue ? (
          <Text style={{ color: "red", fontSize: 12, marginTop: 4 }}>
            {`"${invalidRawValue}" : this date doesn't respect the format '${expectedDateFormat}'`}
          </Text>
        ) : null}
        <Animated.View
          style={{ height: this.state.height, overflow: "hidden" }}
        >
          <DatePickerIOS
            mode={locals.mode}
            accessibilityLabel={locals.label}
            value={validValue || new Date()}
            maximumDate={locals.maximumDate}
            minimumDate={locals.minimumDate}
            minuteInterval={locals.minuteInterval}
            onChange={this._onDateChange}
            timeZoneOffsetInMinutes={locals.timeZoneOffsetInMinutes}
            style={[datepickerStyle, { height: height }]}
          />
        </Animated.View>
      </View>
    );
  }
}

CollapsibleDatePickerIOS.propTypes = {
  locals: PropTypes.object.isRequired
};

function datepicker(locals) {
  if (locals.hidden) {
    return null;
  }

  const stylesheet = locals.stylesheet;
  let formGroupStyle = stylesheet.formGroup.normal;
  let controlLabelStyle = stylesheet.controlLabel.normal;
  let helpBlockStyle = stylesheet.helpBlock.normal;
  const errorBlockStyle = stylesheet.errorBlock;

  if (locals.hasError) {
    formGroupStyle = stylesheet.formGroup.error;
    controlLabelStyle = stylesheet.controlLabel.error;
    helpBlockStyle = stylesheet.helpBlock.error;
  }

  const label = locals.label ? (
    <Text style={controlLabelStyle}>{locals.label}</Text>
  ) : null;
  const help = locals.help ? (
    <Text style={helpBlockStyle}>{locals.help}</Text>
  ) : null;
  const error =
    locals.hasError && locals.error ? (
      <Text accessibilityLiveRegion="polite" style={errorBlockStyle}>
        {locals.error}
      </Text>
    ) : null;

  return (
    <View style={formGroupStyle}>
      {label}
      <CollapsibleDatePickerIOS locals={locals} />
      {help}
      {error}
    </View>
  );
}

module.exports = datepicker;
