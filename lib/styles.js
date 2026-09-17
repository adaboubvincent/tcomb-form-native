import { StyleSheet } from "react-native";

export default StyleSheet.create({
    label: { fontWeight: 'bold', marginBottom: 4, color: 'black' },
  selectBox: { padding: 12, borderRadius: 6 },
  selectedText: { },
  disabledBox: { backgroundColor: '#444' },
  modalOverlay: {
    flex: 1,
    backgroundColor: '#000000aa',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    padding: 20,
    borderRadius: 10,
    width: '95%',
    maxHeight: '80%',
    backgroundColor: "white"
  },
  option: { paddingVertical: 12, borderBottomColor: 'black', borderWidth: 0.5 },
  optionText: { color: 'black', fontSize: 16 },
  searchInput: {
    borderWidth: 1,
    borderColor: '#dddddd',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    marginBottom: 8,
    color: '#000',
  },
  searchEmpty: { color: '#aaa', fontSize: 14, paddingVertical: 16, textAlign: 'center' },
  help: { fontSize: 12, color: '#aaa', marginTop: 4 },
  error: { fontSize: 12, color: 'red', marginTop: 4 },

  dateContainerViewStyle: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  dateBtn: {
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 3,
    flex: 0.6,
    marginRight: 10,
    paddingVertical: 1,
    minHeight: 0,
  },
  dateBtnToday: {
    flex: 0.4,
  },
  dateBtnLabelStyle: {
    color: 'white',
    fontFamily: 'Poppins_400Regular'
  },
  dateBtnLabelStyleToday: {
    color: 'white',
    fontFamily: 'Poppins_400Regular'
  }

});
