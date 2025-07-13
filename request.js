// request.js
const API_BASE_URL = "http://localhost:3000/api/properties";
const BEARER_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0NzQyZDI3ZS00YWY1LTQ0NTUtYTQ3OS0xNWUyMjBjMjRmMTQiLCJyb2xlcyI6W10sImp0aSI6ImU2OTExZjg1NGI2MzM0OGYxYTc2Mzg4NGUxNzZhNDMzIiwidHlwZSI6ImFjY2VzcyIsImlzcyI6InlvdXJfand0X2lzc3VlciIsImF1ZCI6InlvdXJfand0X2F1ZGllbmNlIiwiaWF0IjoxNzQzOTYxMTU5LCJleHAiOjE3NDQ4NjExNTl9.oFT39r9VznMUY1chr7qMAvBVBr4awiU0ht3AZZL0LFI";

// List of property IDs to update
const propertyIds = [

  "02d21221-45e5-4eb5-a843-9e063aa65fa5",
  "732dccb6-db6e-4823-990c-bfad80672352",""
  // Add more IDs as needed
];

// New status to set
const newStatus = "APPROVED"; // Change to whatever status you need

/**
 * Update the status of a single property
 * @param {string} propertyId - The ID of the property to update
 * @param {string} status - The new status to set
 * @returns {Promise<Response>}
 */
async function updatePropertyStatus(propertyId, status) {
  try {
    const response = await fetch(`${API_BASE_URL}/${propertyId}/status`, {
      method: "PATCH", // or 'PUT' depending on your API
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BEARER_TOKEN}`,
      },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error updating property ${propertyId}:`, error);
    throw error;
  }
}

/**
 * Update status for all properties in the list
 */
async function updateAllProperties() {
  const results = [];

  for (const propertyId of propertyIds) {
    try {
      const result = await updatePropertyStatus(propertyId, newStatus);
      results.push({
        id: propertyId,
        success: true,
        data: result,
      });
      console.log(`Successfully updated property ${propertyId}`);
    } catch (error) {
      results.push({
        id: propertyId,
        success: false,
        error: error.message,
      });
      console.error(`Failed to update property ${propertyId}`);
    }
  }

  // Summary of all updates
  console.log("\nUpdate Summary:");
  console.table(results);

  return results;
}

// Execute the updates
updateAllProperties()
  .then(() => console.log("All updates completed"))
  .catch((err) => console.error("Batch update failed:", err));
