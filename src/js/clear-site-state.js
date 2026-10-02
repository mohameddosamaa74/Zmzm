if (performance.getEntriesByType("navigation")[0]?.type === "reload") {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch (error) {
    console.error("تعذر مسح بيانات الموقع عند إعادة التحميل.", error);
  }
}
