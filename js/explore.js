// Explore page: Google Map + nearby wellness and "third space" places.
(function () {
    const CATEGORIES = [
        { value: 'fitness', label: 'Fitness',
          types: ['gym', 'fitness_center', 'yoga_studio', 'sports_club', 'sports_complex', 'swimming_pool'] },
        { value: 'outdoors', label: 'Outdoors',
          types: ['park', 'hiking_area', 'dog_park'] },
        { value: 'third-space', label: 'Cafés & libraries',
          types: ['cafe', 'coffee_shop', 'library', 'book_store'] },
        { value: 'community', label: 'Community',
          types: ['community_center', 'cultural_center'] }
    ];
    const SEARCH_RADIUS_METERS = 2500;
    const DC_CENTER = { lat: 38.9072, lng: -77.0369 };

    const status = document.getElementById('explore-status');
    const placeList = document.getElementById('place-list');
    const locateButton = document.getElementById('locate-button');

    let maps = null;              // Google Maps classes, once loaded
    let map = null;
    let userMarker = null;        // where the user is
    let placeMarker = null;       // the place they picked
    let category = CATEGORIES[0];
    let center = DC_CENTER;
    let centerLabel = 'downtown D.C.';
    let latestSearch = 0;         // ignore results from older searches

    function setStatus(text, isError = false) {
        status.textContent = text;
        status.classList.toggle('error', isError);
    }

    document.getElementById('category-filter').append(HC.chipGroup({
        options: CATEGORIES,
        selected: [category.value],
        multiple: false,
        label: 'Type of place',
        onChange: ([value]) => {
            category = CATEGORIES.find(item => item.value === value);
            searchPlaces();
        }
    }));

    // Called by the Google Maps script once it loads.
    window.initMap = async function () {
        try {
            const [{ Map }, { AdvancedMarkerElement, PinElement }, { Place }] = await Promise.all([
                google.maps.importLibrary('maps'),
                google.maps.importLibrary('marker'),
                google.maps.importLibrary('places')
            ]);
            maps = { AdvancedMarkerElement, PinElement, Place };
            map = new Map(document.getElementById('map'), { center: DC_CENTER, zoom: 14, mapId: 'DEMO_MAP_ID' });
            locateButton.disabled = false;
            searchPlaces();
        } catch (error) {
            console.error(error);
            setStatus('The map could not load. Please refresh the page.', true);
        }
    };

    // Google calls this if the API key is rejected.
    window.gm_authFailure = () => setStatus('Google Maps rejected the API key, so the map can\'t load.', true);

    async function searchPlaces() {
        if (!maps) return;
        const searchId = ++latestSearch;
        const label = category.label.toLowerCase();
        setStatus(`Searching for ${label} near ${centerLabel}…`);

        try {
            const { places } = await maps.Place.searchNearby({
                locationRestriction: { center, radius: SEARCH_RADIUS_METERS },
                includedPrimaryTypes: category.types,
                maxResultCount: 12,
                fields: ['id', 'displayName', 'formattedAddress', 'location', 'photos']
            });
            if (searchId !== latestSearch) return;

            if (!places || !places.length) {
                placeList.replaceChildren(HC.emptyState(`No ${label} found nearby`, 'Try another type of place.'));
                setStatus(`No results near ${centerLabel}`);
                return;
            }
            placeList.replaceChildren(...places.map(placeCard));
            setStatus(`Showing ${places.length} places near ${centerLabel}`);
        } catch (error) {
            if (searchId !== latestSearch) return;
            console.error('Nearby search failed', error);
            placeList.replaceChildren();
            setStatus('Couldn\'t load nearby places. Please try again.', true);
        }
    }

    function placeCard(place) {
        const photo = place.photos && place.photos[0];
        const name = place.displayName || 'Unnamed place';

        return HC.el('article', { class: 'card place-card' },
            photo
                ? HC.el('img', { class: 'place-photo', src: photo.getURI({ maxWidth: 400, maxHeight: 250 }), alt: '', loading: 'lazy' })
                : HC.el('div', { class: 'place-photo place-photo-empty', 'aria-hidden': 'true', text: category.label }),
            HC.el('div', { class: 'place-body' },
                HC.el('h2', { class: 'card-title', text: name }),
                HC.el('p', { class: 'muted small', text: place.formattedAddress || 'Address unavailable' }),
                HC.el('button', {
                    type: 'button',
                    class: 'btn btn-secondary btn-small',
                    'aria-label': `Show ${name} on the map`,
                    text: 'Show on map',
                    onclick: () => showPlace(place, name)
                })
            )
        );
    }

    function showPlace(place, name) {
        map.panTo(place.location);
        map.setZoom(16);
        if (placeMarker) placeMarker.map = null;
        placeMarker = new maps.AdvancedMarkerElement({ map, position: place.location, title: name });
        document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    locateButton.addEventListener('click', () => {
        if (!navigator.geolocation) {
            setStatus('Your browser doesn\'t support location. Showing downtown D.C. instead.', true);
            return;
        }
        setStatus('Finding your location…');
        navigator.geolocation.getCurrentPosition(
            position => {
                center = { lat: position.coords.latitude, lng: position.coords.longitude };
                centerLabel = 'your location';
                map.setCenter(center);
                map.setZoom(14);

                if (userMarker) userMarker.map = null;
                const pin = new maps.PinElement({ background: '#861F41', borderColor: '#5A1530', glyphColor: '#FFFFFF' });
                userMarker = new maps.AdvancedMarkerElement({ map, position: center, title: 'You are here', content: pin.element });

                searchPlaces();
            },
            () => setStatus('Location access was blocked. Showing downtown D.C. instead.', true)
        );
    });
})();
