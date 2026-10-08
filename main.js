const locationButton = document.getElementById('getLocationButton');
const statusText = document.getElementById('status');
const coordText = document.getElementById('coordinates');

// Create map, marker
let map;
let locationMarker = null;

// Set Default Location (Currently Virginia Tech)
const defaultLocation = {
    lat: 37.22853803921056,
    lng: -80.42335232926663
}

// Initialize the Google Map
async function initMap() {
    const { Map } = await google.maps.importLibrary("maps");
    
    map = new Map(document.getElementById("map"), {
        center: defaultLocation,
        zoom: 13,
        mapId: "DEMO_MAP_ID"
    });
}

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

async function locationSuccess(position) {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;

    // Create object for the location coords
    const userLocation = {
        lat: latitude,
        lng: longitude
    };

    statusText.textContent = "Location found.";
    coordText.innerHTML = `
        <strong>Latitude:</strong> ${latitude}° <br> 
        <strong>Longitude:</strong> ${longitude}°`;

    // Move map to user's location
    map.setCenter(userLocation);
    map.setZoom(16);

    // Load Google's Advanced Marker Library
    const { AdvancedMarkerElement } = 
        await google.maps.importLibrary("marker");

    // Remove the previous marker
    if (locationMarker) {
        locationMarker.map = null;
    }

    // Add marker for the new location
    locationMarker = new AdvancedMarkerElement({
        map: map,
        position: userLocation,
        title: "Current Location"
    });       
}

function locationError(error) {
    statusText.textContent = "Unable to retrieve location. Please allow location access in browser.";
    console.error(error);
}

locationButton.addEventListener('click', findLocation);