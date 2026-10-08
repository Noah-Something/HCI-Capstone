const locationButton = document.getElementById('getLocationButton');
const statusText = document.getElementById('status');
const coordText = document.getElementById('coordinates');

function findLocation() {
    // Check if geolocation API is allowed by the browser 
    if (!navigator.geolocation) {
        statusText.textContent = "Geolocation is not supported within this browser.";
        return;
    }

    statusText.textContent = "Loading...";
    coordText.textContent = "";

    navigator.geolocation.getCurrentPosition(
        locationSuccess, 
        locationError
    );
}

function locationSuccess(position) {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;

    statusText.textContent = "Location found.";
    coordText.innerHTML = `
        <strong>Latitiude:</strong> ${latitude}° <br> 
        <strong>Longitude:</strong> ${longitude}°`;
}

function locationError(error) {
    statusText.textContent = "Unable to retrieve location. Please allow location access in browser.";
    console.error(error);
}

locationButton.addEventListener('click', findLocation);