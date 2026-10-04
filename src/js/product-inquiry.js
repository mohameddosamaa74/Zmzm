import { supabaseClient, supabaseConfigurationError } from "../../supabase-config.js";

const dialog = document.getElementById("productInquiryDialog");
const form = document.getElementById("productInquiryForm");
const productNameInput = document.getElementById("inquiryProductName");
const descriptionInput = document.getElementById("inquiryDescription");
const websiteInput = document.getElementById("inquiryWebsite");
const submitButton = document.getElementById("submitProductInquiry");
const toast = document.getElementById("toast");

function showInquiryToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 3200);
}

document.getElementById("openProductInquiry")?.addEventListener("click", () => {
  form.reset();
  productNameInput.setCustomValidity("");
  dialog.showModal();
  productNameInput.focus();
});

function closeInquiryDialog() {
  dialog.close();
}

productNameInput?.addEventListener("input", () => productNameInput.setCustomValidity(""));

document.getElementById("closeProductInquiry")?.addEventListener("click", closeInquiryDialog);
document.getElementById("cancelProductInquiry")?.addEventListener("click", closeInquiryDialog);

dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) closeInquiryDialog();
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const productName = productNameInput.value.trim();
  const description = descriptionInput.value.trim();

  if (!productName) {
    productNameInput.setCustomValidity("اكتب اسم المنتج المطلوب.");
    productNameInput.reportValidity();
    return;
  }
  productNameInput.setCustomValidity("");

  if (!supabaseClient) {
    showInquiryToast(supabaseConfigurationError);
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "جارٍ إرسال الطلب…";
  let failureMessage = "تعذر إرسال الاستفسار الآن. حاول مرة أخرى بعد قليل.";
  try {
    const { error } = await supabaseClient.functions.invoke("create-product-inquiry", {
      body: {
        product_name: productName,
        description: description || null,
        website: websiteInput.value,
      },
    });
    if (error) {
      if (error.context?.status === 429) {
        failureMessage = "تم إرسال استفسارات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.";
      } else if (error.context?.status === 503) {
        failureMessage = "خدمة الاستفسارات غير جاهزة حالياً. حاول مرة أخرى لاحقاً.";
      }
      throw error;
    }

    form.reset();
    closeInquiryDialog();
    showInquiryToast("تم استلام استفسارك، شكراً لك.");
  } catch (error) {
    console.error("تعذر حفظ استفسار المنتج.", error);
    showInquiryToast(failureMessage);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "إرسال الطلب";
  }
});
