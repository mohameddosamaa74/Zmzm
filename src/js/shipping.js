export const FREE_SHIPPING_THRESHOLD = 500;
export const DELIVERY_TIME_NOTE = "مدة التوصيل من 2 إلى 5 أيام.";

const SHIPPING_RATES = {
  السويس: 40,
  القاهرة: 65,
  الجيزة: 65,
  الإسماعيلية: 65,
  بورسعيد: 65,
};

export function getShippingFee(subtotal, governorate = "") {
  if (subtotal <= 0 || subtotal >= FREE_SHIPPING_THRESHOLD) return 0;
  if (!governorate) return null;
  return SHIPPING_RATES[governorate] ?? 85;
}
