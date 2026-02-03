let HospitalMinimumRating;
let ReviewLinkUrl;
let isSubmitting = false;
let globalConfig = null;
let reviewFormRes = null;

// Function to format email body with individual ratings
// Function to format email body with individual ratings (numeric only)
function formatEmailBodyWithRatings(reviewData) {
  // Start with basic information
  let body = `Name: ${reviewData.FullName}\n`;
  body += `Phone Number: ${reviewData.PhoneNumber}\n`;
  body += `Email: ${reviewData.EmailId}\n`;
  body += `Overall Rating: ${reviewData.StarRating}\n\n`;
  
  // Add individual ratings section
  body += " Individual Ratings:\n";
  
  // Check if we have metric ratings
  if (reviewData.MetricsRatings && reviewData.MetricsRatings.length > 0) {
    // Loop through each metric rating
    reviewData.MetricsRatings.forEach(metric => {
      // Add each metric with just its numeric rating
      body += `${metric.MetricsName}: ${metric.Rating}/5\n`;
    });
  }
  
  body += "\n";
  
  // Add comments if available
  if (reviewData.Description && reviewData.Description.trim() !== "") {
    body += ` Comments :\n${reviewData.Description}`;
  }
  
  return body;
}

async function loadConfig() {
  try {
    const response = await fetch("./config.json");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const config = await response.json();

    if (config.JGDEnvironment) {
      globalConfig = config.mainConfig;
    } else {
      globalConfig = config.alternateConfig;
    }

    if (config.HospitalId) {
      globalConfig.HospitalId = config.HospitalId;
    } else {
      console.error("HospitalId not found in config.json");
    }

    globalConfig.JGDEnvironment = config.JGDEnvironment;
    globalConfig.SendEmailForAllRatings = config.SendEmailForAllRatings;
    setLogoInSteps(config.Logo_URL);
    if (globalConfig.JGDEnvironment) {
      await GetClinicReviewRatingLevel();
    } else {
      await googlereviewURL();
    }
	getRatingform();
  } catch (error) {
    console.error("Error loading config:", error);
  }
}

function calculateAverageRating() {
  let totalRating = 0;
  let categoryCount = 0;

  $(".star-rating").each(function () {
    let categoryRating = 0;
    let count = 0;

    $(this)
      .find("i")
      .each(function () {
        if ($(this).hasClass("bi-star-fill")) {
          categoryRating = parseInt($(this).data("rate"));
          count++;
        }
      });

    if (count > 0) {
      totalRating += categoryRating;
      categoryCount++;
    }
  });

  return categoryCount > 0 ? (totalRating / categoryCount).toFixed(2) : 0;
}

async function GetClinicReviewRatingLevel() {
  if (globalConfig && globalConfig.GetClinicReviewRatingLevel) {
    try {
      const response = await axios.get(
        globalConfig.GetClinicReviewRatingLevel + `${globalConfig.HospitalId}`
      );
      HospitalMinimumRating = response?.data?.data?.HospitalMinimumRating;
      ReviewLinkUrl = response?.data?.data?.ReviewLinkUrl;
    } catch (error) {
      console.error("Error fetching clinic review rating level:", error);
    }
  } else {
    console.error("API URL for GetClinicReviewRatingLevel is not defined.");
  }
}
async function googlereviewURL() {
  if (globalConfig && globalConfig.googlereviewURL) {
    try {
      ReviewLinkUrl = globalConfig.googlereviewURL;
      HospitalMinimumRating = globalConfig.thershold_value || 0;
    } catch (error) {
      console.error("Error fetching Google review URL:", error);
    }
  } else {
    console.error("Google review URL is not defined.");
  }
}

async function sendMainConfigMail(event) {
  event.preventDefault();

  if (isSubmitting) return; // Prevent duplicate submissions
  isSubmitting = true; // Set the flag to true

  const submitButton = document.querySelector('button[type="submit"]');
  submitButton.textContent = "Loading...";
  submitButton.disabled = true;

  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  let allRated = true;
  $(".star-rating").each(function () {
    if ($(this).find(".bi-star-fill").length === 0) {
      allRated = false;
      return false;
    }
  });

  if (!allRated) {
    alert("Please fill rating by all the fields.");
    resetSubmitButton();
    isSubmitting = false; // Reset the flag
    return;
  }

  const averageRating = calculateAverageRating();
  console.log("Average rating:", averageRating);
  let reviews = [];
  reviewFormRes.Configurations.Metrics.forEach(item => {
    metricsRatings.forEach(r => {
      if(r.MetricsName == item.Name.replace(/\s+/g, "")) {
        item['Rating'] = r.Rating;
      }
    });
    item['MetricsName'] = item.Name;
    reviews.push(item);
  });
  
  const reviewData = {
    FullName: $("#name").val() || "",
    PhoneNumber: $("#phone").val() || "",
    EmailId: $("#email").val() || "",
    Description: $("#comments").val() || "",
    StarRating: averageRating,
    MetricsRatings: reviews,
    Device: 3,
    HospitalId: globalConfig.HospitalId,
  };

  // Copy to clipboard if description is provided
  if (reviewData.Description.trim() !== "") {
    try {
      await navigator.clipboard.writeText(reviewData.Description);
      showToast("Comments copied to clipboard!");
    } catch (err) {
      console.error("Could not copy text: ", err);
      // Fall back to alternate copy method if clipboard API fails
      copyTextToClipboard(reviewData.Description);
    }
  }

  try {
    // Check if rating meets minimum threshold for Google redirection
    const shouldRedirectToGoogle = averageRating >= HospitalMinimumRating;
    
    // For high ratings, redirect to Google review page
    if (shouldRedirectToGoogle) {
      try {
        if (!isIOS) {
          window.open(ReviewLinkUrl);
        } else { 
          window.location.href = ReviewLinkUrl;
        }
      } catch (error) {
        console.error("Error redirecting to review page:", error);
      }
    } else {
      // For lower ratings, redirect to first page
      window.location.hash = "#step1";
    }
    
    // Now call the SaveCustomerReviewRatings API
    const postResponse = await axios.post(
      globalConfig.SaveCustomerReviewRatings,
      reviewData
    );
    console.log("API Response post rating:", postResponse?.data);
    
    // Prepare and send the email with individual ratings
    var formData = new FormData();
    var body = formatEmailBodyWithRatings(reviewData);
    console.log("Body content:", body);

    formData.append("Body", body);
    formData.append("Subject", "Google Review Form");
    formData.append("ToEmail", globalConfig.ToEmail || "");

    // Send the career mail
    var emailResponse = await axios.post(globalConfig.SendCareerMail, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
    console.log("API Response post career mail:", emailResponse?.data);
    
    // Show success message after API calls
    alert("Review Sent Successfully!");
    resetForm();
    
  } catch (error) {
    console.error("Error in review submission process:", error);
    alert("Failed to Submit.");
  } finally {
    resetSubmitButton();
    isSubmitting = false; // Reset the flag
  }
}

function sendalternateConfigMail(event) {
  event.preventDefault();
  if (isSubmitting) {
    return;
  }
  isSubmitting = true;

  const submitButton = document.querySelector('button[type="submit"]');
  submitButton.textContent = "Loading...";
  submitButton.disabled = true;

  // Calculate average rating here
  const averageRating = calculateAverageRating();
  let reviews = [];
  reviewFormRes.Configurations.Metrics.forEach(item => {
    metricsRatings.forEach(r => {
      if(r.MetricsName == item.Name.replace(/\s+/g, "")) {
        item['Rating'] = r.Rating;
      }
    });
    item['MetricsName'] = item.Name;
    reviews.push(item);
  });
  
  const reviewData = {
    FullName: $("#name").val() || "",
    PhoneNumber: $("#phone").val() || "",
    EmailId: $("#email").val() || "",
    Description: $("#comments").val() || "",
    StarRating: averageRating,
    MetricsRatings: reviews,
    Device: 3,
    HospitalId: globalConfig.HospitalId,
  };

  // Copy comments to clipboard if available
  if (reviewData.Description.trim() !== "") {
    copyTextToClipboard(reviewData.Description);
  }

  const apiEndpoint = globalConfig.google_mail;
  const toEmail = globalConfig.ToEmail;
  const googleReviewUrl = globalConfig.googlereviewURL;

  if (!apiEndpoint || !toEmail || !googleReviewUrl) {
    console.error("Missing configuration for email or review URL.");
    isSubmitting = false;
    resetSubmitButton();
    return;
  }

  // Format email body with individual ratings
  const body = formatEmailBodyWithRatings(reviewData);
  console.log("Body content:", body);
  
  const formData = new FormData();
  formData.append("Body", body);
  formData.append("Subject", "Google Review Form");
  formData.append("ToEmail", toEmail);

  $.ajax({
    url: apiEndpoint,
    type: "POST",
    data: formData,
    processData: false,
    contentType: false,
    success: function () {
      console.log("Email sent successfully.");
      alert("Review submitted successfully!");
      
      // For high ratings, redirect to Google Review after email is sent
      if (reviewData.StarRating >= 4) {
        console.log("Redirecting to Google Review URL:", googleReviewUrl);
        window.open(googleReviewUrl, "_blank");
      }
      
      resetForm();
      window.location.hash = "#step1";
    },
    error: function (xhr, status, error) {
      console.error("Error sending email:", error);
      alert("Failed to send the review email. Please try again.");
    },
    complete: function () {
      resetSubmitButton();
      isSubmitting = false;
    },
  });
}

function sendEmailForAllRatings(reviewData) {
  // Check if already submitting
  if (isSubmitting) {
    return; // Prevent multiple submissions
  }

  // Set flag to prevent multiple submissions
  isSubmitting = true;

  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Check if globalConfig exists
  if (!globalConfig) {
    console.error("globalConfig is not defined");
    isSubmitting = false;
    return;
  }

  // Check if required properties are defined in globalConfig
  const apiEndpoint = globalConfig.google_mail;
  const toEmail = globalConfig.ToEmail;
  const googleReviewUrl = globalConfig.googlereviewURL;

  if (!apiEndpoint || !toEmail || !googleReviewUrl) {
    console.error("Missing required configuration");
    isSubmitting = false;
    return;
  }

  console.log("Review Data:", reviewData);

  // Send the email for ALL ratings with individual ratings included
  const body = formatEmailBodyWithRatings(reviewData);
  console.log("Body content:", body);

  const formData = new FormData();
  formData.append("Body", body);
  formData.append("Subject", "Google Review Form");
  formData.append("ToEmail", toEmail);

  console.log("Making API call to:", apiEndpoint);

  $.ajax({
    url: apiEndpoint,
    type: "POST",
    data: formData,
    processData: false,
    contentType: false,
    success: function (response) {
      console.log("API Response post email:", response);
      
      
      // Only redirect for high ratings after email is sent
      if (reviewData.StarRating >= 4) {
        setTimeout(() => {
          console.log("Redirecting to Google Review URL:", googleReviewUrl);
          if (isIOS) {
            window.location.href = googleReviewUrl; // Redirect in the same tab
          } else {
            window.open(googleReviewUrl); // Open in a new tab for non-iOS
          }
        }, 1000); // Slight delay for redirection
      }
      alert("Review sent successfully!");
      resetForm();
    },
    error: function (xhr, status, error) {
      console.error("Error sending email:", error);
      console.error("Error response status:", xhr.status);
      console.error("Error response text:", xhr.responseText);
      alert("Failed to send review. Please try again later.");
    },
    complete: function () {
      resetSubmitButton();
      isSubmitting = false;
    },
  });
}

$("#twoStepForm").on("submit", function (event) {
  event.preventDefault();
  if (!isSubmitting) {
    sendalternateConfigMail(event);
  }
});

function handleAlternativeEmailSending(toEmail) {
  const reviewData = {
    name: $("#name").val() || "",
    phone: $("#phone").val() || "",
    email: $("#email").val() || "",
    rating: calculateAverageRating(),
    comments: $("#comments").val() || "",
  };

  // Format the body with individual ratings if metrics are available
  const body = formatEmailBodyWithRatings({
    FullName: reviewData.name,
    PhoneNumber: reviewData.phone,
    EmailId: reviewData.email,
    StarRating: reviewData.rating,
    Description: reviewData.comments,
    MetricsRatings: metricsRatings.map(metric => ({
      MetricsName: metric.MetricsName,
      Rating: metric.Rating
    }))
  });

  console.log("Alternative email sending:");
  console.log("To:", toEmail);
  console.log("Subject: Google Review Form");
  console.log("Body:", body);
  // alert('Email information logged successfully. Check console for details.');
  resetForm();
}

async function submitForm(event) {
  event.preventDefault();

  const submitButton = $('button[type="submit"]');
  submitButton.text("Loading...").prop("disabled", true);

  let allRated = true;
  $(".star-rating").each(function () {
    if ($(this).find(".bi-star-fill").length === 0) {
      allRated = false;
      return false;
    }
  });

  if (!allRated) {
    alert('Please provide a rating for all categories.');
    resetSubmitButton();
    return;
  }

  const averageRating = calculateAverageRating();
  console.log("Average rating:", averageRating);
  
  let reviews = [];
  reviewFormRes.Configurations.Metrics.forEach(item => {
    metricsRatings.forEach(r => {
      if(r.MetricsName == item.Name.replace(/\s+/g, "")) {
        item['Rating'] = r.Rating;
      }
    });
    item['MetricsName'] = item.Name;
    reviews.push(item);
  });

  const reviewData = {
    FullName: $("#name").val() || "",
    PhoneNumber: $("#phone").val() || "",
    EmailId: $("#email").val() || "",
    Description: $("#comments").val() || "",
    StarRating: averageRating,
    MetricsRatings: reviews,
    Device: 3,
    HospitalId: globalConfig.HospitalId,
  };

  if (reviewData.Description.trim() !== "") {
    try {
      await navigator.clipboard.writeText(reviewData.Description);
      console.log("Comments copied to clipboard");
    } catch (err) {
      console.error("Could not copy text: ", err);
      copyTextToClipboard(reviewData.Description);
    }
  }

  // Modified logic to ensure email is sent for all ratings
  if (globalConfig.SendEmailForAllRatings && globalConfig.JGDEnvironment) {
    console.log(
      "Both SendEmailForAllRatings and JGDEnvironment are true. Calling mainConfig logic."
    );
    try {
      await sendMainConfigMail(event); // Call mainConfig logic
      console.log("MainConfig mail sent successfully.");
    } catch (error) {
      console.error("Error in mainConfig logic:", error);
      alert("Failed to submit review. Please try again.");
      resetSubmitButton();
      isSubmitting = false;
    }
  } else if (globalConfig.SendEmailForAllRatings) {
    console.log(
      "SendEmailForAllRatings is true. Sending email for all ratings."
    );
    try {
      await sendEmailForAllRatings(reviewData); // Send email for all ratings
      console.log("Email sent for all ratings.");
    } catch (error) {
      console.error("Error in sendEmailForAllRatings:", error);
      alert("Failed to submit review. Please try again.");
      resetSubmitButton();
      isSubmitting = false;
    }
  } else if (globalConfig.JGDEnvironment) {
    console.log("JGDEnvironment is true. Calling mainConfig logic.");
    try {
      await sendMainConfigMail(event); // Call mainConfig logic
    } catch (error) {
      console.error("Error in mainConfig logic:", error);
      alert("Failed to submit review. Please try again.");
      resetSubmitButton();
      isSubmitting = false;
    }
  } else {
    console.log("Calling alternateConfig logic as fallback.");
    try {
      await sendalternateConfigMail(event); // Call alternateConfig logic
    } catch (error) {
      console.error("Error in alternateConfig logic:", error);
      alert("Failed to submit review. Please try again.");
      resetSubmitButton();
      isSubmitting = false;
    }
  }
}

$("#reviewForm").on("submit", submitForm);

function showSuccessMessage(message) {
  const successMessageDiv = document.getElementById("successMessage");
  successMessageDiv.textContent = message;
  successMessageDiv.style.display = "block";
  setTimeout(() => {
    successMessageDiv.style.display = "none";
  }, 100);
}

$("#twoStepForm").on("submit", function (event) {
  submitForm(event);
});

function resetSubmitButton() {
  const submitButton = document.querySelector('button[type="submit"]');
  submitButton.textContent = "Submit";
  submitButton.disabled = false;
}

function resetForm() {
  $("#twoStepForm")[0].reset();
  $(".error-message").text("").hide();
  $(".star-rating i").removeClass("bi-star-fill").addClass("bi-star");
  $("#step2").addClass("d-none");
  $("#step1").removeClass("d-none");
}

// Initialize
$(document).ready(function () {
  $("#nextStep").click(function () {
    if (validateStep1()) {
      $("#step1").addClass("d-none");
      $("#step2").removeClass("d-none");
    }
  });

  $(".star-rating i").click(function () {
    var rating = $(this).data("rate");
    $(this).siblings().removeClass("bi-star-fill").addClass("bi-star");
    $(this).prevAll().addBack().removeClass("bi-star").addClass("bi-star-fill");
  });

  $("#twoStepForm").submit(submitForm);

  $('button[type="reset"]').click(function () {
    resetForm();
  });
});

function validateStep1() {
  let valid = true;
  const name = document.getElementById("name").value.trim();
  if (name === "") {
    document.getElementById("name-error").textContent = "Name is required.";
    document.getElementById("name-error").style.display = "block";
    valid = false;
  } else {
    document.getElementById("name-error").style.display = "none";
  }
  // Validate Phone (mandatory)
  const phone = document.getElementById("phone").value.trim();
  const phonePattern = /^[0-9]{10,15}$/; // Simple regex to validate phone numbers
  if (phone === "") {
    document.getElementById("phone-error").textContent =
      "Phone number is required.";
    document.getElementById("phone-error").style.display = "block";
    valid = false;
  } else if (!phonePattern.test(phone)) {
    document.getElementById("phone-error").textContent =
      "Please enter a valid phone number.";
    document.getElementById("phone-error").style.display = "block";
    valid = false;
  } else {
    document.getElementById("phone-error").style.display = "none";
  }
  return valid;
}

function setLogoInSteps(logoUrl) {
  const logoImgStep1 = document.querySelector("#step1 .logo");
  if (logoImgStep1) {
    logoImgStep1.src = logoUrl;
    console.log("Step 1 Logo set to:", logoImgStep1.src);
  } else {
    console.error("Logo element not found in Step 1");
  }

  const logoImgStep2 = document.querySelector("#step2 .logo");
  if (logoImgStep2) {
    logoImgStep2.src = logoUrl;
    console.log("Step 2 Logo set to:", logoImgStep2.src);
  } else {
    console.error("Logo element not found in Step 2");
  }
}

// Global variable to store metrics ratings
let metricsRatings = [];

// Map display labels to metric names
const metricNameMapping = {
  "Explain Condition Well": "ExplainConditionsWell",
  "Staff Friendliness": "StaffFriendliness",
  "Clinic Environment": "ClinicEnvironment",
  "Doctor Easily Approchable": "DoctorEasilyApprochable",
  "Prompt Follow Up": "PromptFollowUp",
  "Staff Interaction": "StaffInteraction",
  "Scan Centre Cleanliness": "ScanCentreCleanliness",
  "Test Results Accuracy": "TestResultsAccuracy",
  "Overall Satisfaction": "OverallSatisfaction",
  "Kindly Rate Us": "KindlyRateUs",
};

// Initialize ratings on document ready
$(document).ready(function () {
  console.log("Initializing metrics ratings");

  // Clear previous metrics if any
  metricsRatings = [];

  startRatingInit();
});

// Function to update a specific metric rating
function updateMetricRating(metricName, rating) {
  // Find the metric in the array
  const existingMetricIndex = metricsRatings.findIndex(
    (m) => m.MetricsName === metricName
  );

  if (existingMetricIndex !== -1) {
    // Update existing metric
    metricsRatings[existingMetricIndex].Rating = parseFloat(rating);
  } else {
    // Add new metric
    metricsRatings.push({
      MetricsName: metricName,
      Rating: parseFloat(rating),
    });
  }
}

function startRatingInit(){
  // Pre-populate metric objects with default rating of 0
  $(".star-rating").each(function (index) {
    const $container = $(this);
    const labelText = $container.closest(".row").find("label").text().trim();
    const metricName =
      metricNameMapping[labelText] || labelText.replace(/\s+/g, "");

    // Add metric with default rating of 0
    metricsRatings.push({
      MetricsName: metricName,
      Rating: 0,
    });

    console.log(`Initialized metric ${index + 1}: ${metricName}`);
  }); 

  // Set up click event for all star ratings
  $(".star-rating i").click(function () {
    const rating = parseInt($(this).data("rate"));
    const $starContainer = $(this).parent();

    // Find the label text associated with this star rating
    const labelText = $starContainer
      .closest(".row")
      .find("label")
      .text()
      .trim();

    // Get the metric name from the mapping
    const metricName =
      metricNameMapping[labelText] || labelText.replace(/\s+/g, "");

    // Update UI - remove filled class from all stars in this container
    $starContainer.find("i").removeClass("bi-star-fill").addClass("bi-star");

    // Fill stars up to and including the clicked star
    $(this).prevAll().addBack().removeClass("bi-star").addClass("bi-star-fill");

    // Update or add the metric in the metricsRatings array
    updateMetricRating(metricName, rating);

    console.log(`Updated rating: ${metricName} = ${rating}`);
    console.log("Current metrics:", JSON.stringify(metricsRatings));
  });
}

function getRatingform(){
  if (!globalConfig) {
    console.error("globalConfig is not defined");
    return;
  }
  const apiEndpoint = globalConfig.apiurl+'api/ClinicReview/ReviewFormConfig?HospitalId='+globalConfig.HospitalId;  
  
  $.ajax({
    url: apiEndpoint,
    type: 'GET',
    contentType: 'application/json',
    success: function (response) {
      if(response){
        reviewFormRes=response;
        let Configurations=response.Configurations;
        let html='';
        Configurations.Metrics.forEach(item => {
          if(item.EnableStarRating){					  
            html+='<div class="mb-3 row"> <div class="col-sm-7"> <label class="form-label">'+item.Name+'</label> </div>';				  
            html+='<div class="col-sm-5"> <div class="star-rating"> <i class="bi bi-star" data-rate="1"></i> <i class="bi bi-star" data-rate="2"></i> ';				
            html+='<i class="bi bi-star" data-rate="3"></i> <i class="bi bi-star" data-rate="4"></i> <i class="bi bi-star" data-rate="5"></i></div></div></div>';
          }
        });
        if(Configurations.EnableUserFeedback){
          html+='<div class="mb-3 row"> <div class="col-sm-3"> <label for="comments" class="form-label">Comments</label> </div>';
          html+='<div class="col-sm-9"><textarea class="form-control" id="comments" rows="3"></textarea></div></div>';
        }
        $('#ratingform').html(html);
        startRatingInit();
      }
    },
    error: function (xhr, status, error) {
      console.error("Error fetching rating form:", error);
      console.error("Error response status:", xhr.status);
      console.error("Error response text:", xhr.responseText);
    },
    complete: function () {
      // Complete handler
    },
  });  
}

// Universal clipboard function that works across platforms
function copyTextToClipboard(text) {
  // Create hidden input for copying
  const textArea = document.createElement("textarea");
  textArea.value = text;

  // Make the textarea out of viewport
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  textArea.style.top = "-999999px";
  document.body.appendChild(textArea);

  // Check if we're on iOS
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  // Check if we're on Android
  const isAndroid = /Android/.test(navigator.userAgent);

  if (isIOS) {
    // iOS-specific handling
    const range = document.createRange();
    range.selectNodeContents(textArea);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    textArea.setSelectionRange(0, 999999);
  } else if (isAndroid) {
    // Android-specific handling
    textArea.focus();
    textArea.select();
  } else {
    // Desktop handling
    textArea.select();
  }

  let success = false;
  try {
    // Try to copy using document.execCommand
    success = document.execCommand("copy");

    if (success) {
      showToast("Comments copied to clipboard!");
    } else {
      // If execCommand fails, try Clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            showToast("Comments copied to clipboard!");
          })
          .catch(() => {
            // If all else fails, show manual copy dialog for Android
            if (isAndroid) {
              showManualCopyDialog(text);
            } else {
              showToast("Unable to copy automatically. Please copy manually.");
            }
          });
      } else if (isAndroid) {
        // For Android without Clipboard API support
        showManualCopyDialog(text);
      }
    }
  } catch (err) {
    console.error("Failed to copy text: ", err);

    // Fallback for Android
    if (isAndroid) {
      showManualCopyDialog(text);
    } else {
      showToast("Unable to copy automatically. Please copy manually.");
    }
  }

  // Clean up
  document.body.removeChild(textArea);
  return success;
}

// Show a manual copy dialog for Android devices
function showManualCopyDialog(text) {
  // Create modal container
  const modal = document.createElement("div");
  modal.style.position = "fixed";
  modal.style.top = "0";
  modal.style.left = "0";
  modal.style.width = "100%";
  modal.style.height = "100%";
  // Continuing from the previous part
  modal.style.backgroundColor = "rgba(0,0,0,0.7)";
  modal.style.zIndex = "9999";
  modal.style.display = "flex";
  modal.style.justifyContent = "center";
  modal.style.alignItems = "center";

  // Create modal content
  const content = document.createElement("div");
  content.style.backgroundColor = "white";
  content.style.padding = "20px";
  content.style.borderRadius = "8px";
  content.style.width = "80%";
  content.style.maxWidth = "500px";

  // Create title
  const title = document.createElement("h3");
  title.textContent = "Copy Your Comments";
  title.style.marginTop = "0";
  title.style.marginBottom = "15px";

  // Create instructions
  const instructions = document.createElement("p");
  instructions.textContent =
    'Press and hold on the text below, then select "Copy":';

  // Create text display area
  const textDisplay = document.createElement("div");
  textDisplay.textContent = text;
  textDisplay.style.padding = "10px";
  textDisplay.style.border = "1px solid #ccc";
  textDisplay.style.borderRadius = "4px";
  textDisplay.style.backgroundColor = "#f9f9f9";
  textDisplay.style.marginBottom = "15px";
  textDisplay.style.wordBreak = "break-word";

  // Create close button
  const closeButton = document.createElement("button");
  closeButton.textContent = "Close";
  closeButton.style.padding = "8px 16px";
  closeButton.style.backgroundColor = "#4CAF50";
  closeButton.style.color = "white";
  closeButton.style.border = "none";
  closeButton.style.borderRadius = "4px";
  closeButton.style.cursor = "pointer";
  closeButton.style.float = "right";

  // Add event listener to close button
  closeButton.addEventListener("click", function () {
    document.body.removeChild(modal);
  });

  // Assemble modal
  content.appendChild(title);
  content.appendChild(instructions);
  content.appendChild(textDisplay);
  content.appendChild(closeButton);
  modal.appendChild(content);

  // Add modal to body
  document.body.appendChild(modal);
}

// Show a toast message
function showToast(message) {
  // Create toast container if it doesn't exist
  let toastContainer = document.getElementById("toast-container");
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toast-container";
    toastContainer.style.position = "fixed";
    toastContainer.style.bottom = "20px";
    toastContainer.style.left = "50%";
    toastContainer.style.transform = "translateX(-50%)";
    toastContainer.style.zIndex = "9999";
    document.body.appendChild(toastContainer);
  }

  // Create toast
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.backgroundColor = "rgba(0,0,0,0.7)";
  toast.style.color = "white";
  toast.style.padding = "10px 20px";
  toast.style.borderRadius = "4px";
  toast.style.marginBottom = "10px";
  toast.style.boxShadow = "0 2px 5px rgba(0,0,0,0.2)";

  // Add toast to container
  toastContainer.appendChild(toast);

  // Remove toast after 3 seconds
  setTimeout(function () {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.5s";

    // Remove from DOM after fade out
    setTimeout(function () {
      if (toastContainer.contains(toast)) {
        toastContainer.removeChild(toast);
      }

      // Remove container if empty
      if (toastContainer.childNodes.length === 0) {
        document.body.removeChild(toastContainer);
      }
    }, 500);
  }, 3000);
}

// Initialize the configuration on page load
loadConfig();