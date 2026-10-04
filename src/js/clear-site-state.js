if (performance.getEntriesByType("navigation")[0]?.type === "reload") {
  try {
    localStorage.removeItem("zmzm-cart");
    localStorage.removeItem("zmzm-wishlist");
  } catch (error) {
    console.error("تعذر مسح السلة والمفضلة عند إعادة تحميل الموقع.", error);
  }
}
