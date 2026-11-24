/* ฟังก์ชันกลางสำหรับอ่านและเขียนข้อมูลใน Browser Storage */
const AppStorage = {
  read(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  },

  write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },

  remove(key) {
    localStorage.removeItem(key);
  },

  readSession(key, fallback = null) {
    try {
      const value = sessionStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  },

  writeSession(key, value) {
    sessionStorage.setItem(key, JSON.stringify(value));
  },

  removeSession(key) {
    sessionStorage.removeItem(key);
  }
};
