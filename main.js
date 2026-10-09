const locationButton = document.getElementById('getLocationButton');
const statusText = document.getElementById('status');
const coordText = document.getElementById('coordinates');
const resultsContainer = document.getElementById("landmarkResults");

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

async function executeSearch(location) {
    try {
        const { Place } = await google.maps.importLibrary("places");

        const request = {
            locationRestriction: {
                center: location,
                radius: 2000
            },
            includedTypes: [
                'tourist_attraction', 
                'historical_landmark', 
                'monument',
                'amusement_park', 
                'aquarium', 
                'botanical_garden', 
                'city_park', 
                'cultural_center', 
                'historical_landmark', 
                'national_park', 
                'observation_deck', 
                'park', 
                'tourist_attraction', 
                'visitor_center', 
                'zoo'],
            maxResultCount: 10,
            fields: [
                'displayName', 
                'formattedAddress', 
                'types', 
                'location',
                'photos']
        };
    
        const { places } = await Place.searchNearby(request);

        // Clear previous container results
        resultsContainer.innerHTML = "";

        if (!places || places.length == 0) {
            console.log("No landmarks found in the nearby area/radius.")
            resultsContainer.innerHTML = `
                <p class="no-results">
                    No landmarks found nearby.
                </p>
            `;
            return;
        }

        places.forEach(place => {
            console.log(`Landmark Name: ${place.displayName}`);
            console.log(`Types/Categories:`, place.types);
            console.log(`Address: ${place.formattedAddress}`);
            console.log(place.displayName, place.photos?.length, place.photos?.[0]?.getURI({ maxWidth: 400 }));
            console.log(place.displayName, place.id, place.googleMapsURI, place.photos?.length);
            console.log(`-----------------------------------`);

            const card = document.createElement("div");
            card.className = "landmark-card";

            const image = document.createElement("img");
            image.className = "landmark-image";

            if (place.photos && place.photos.length > 0) {
                image.src = place.photos[0].getURI({
                    maxWidth: 400,
                    maxHeight: 250
                });
            } else {
                image.src = "https://via.placeholder.com/400x250?text=No+Image";
            }

            const content = document.createElement("div");
            content.className = "landmark-content";

            const title = document.createElement("h3");
            title.textContent = place.displayName || "Unknown Landmark";

            const address = document.createElement("p");
            address.textContent = place.formattedAddress || "Address unavailable";

            const button = document.createElement("button");
            button.textContent = "View on Map";

            button.addEventListener("click", () => {
                map.setCenter(place.location);
                map.setZoom(17);

                if (locationMarker) {
                    locationMarker.map = null;
                }
                
                locationMarker = new 
                google.maps.marker.AdvancedMarkerElement({
                    map: map,
                    position: place.location,
                    title: place.displayName
                });
            });

            content.appendChild(title);
            content.appendChild(address);
            content.appendChild(button);

            card.appendChild(image);
            card.appendChild(content);

            resultsContainer.appendChild(card);
        });

    } catch(error) {
        console.error("Error fetching nearby landmarks", error)
    }
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

    executeSearch(userLocation);
}

function locationError(error) {
    statusText.textContent = "Unable to retrieve location. Please allow location access in browser.";
    console.error(error);
}

locationButton.addEventListener('click', findLocation);