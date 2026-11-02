// Sample data for the prototype. Everything here is made up and will be
// replaced by real data from the backend later.
window.HC = window.HC || {};

HC.INTERESTS = [
    'Running', 'Cycling', 'Yoga', 'Hiking', 'Climbing', 'Pickup sports',
    'Gym & lifting', 'Cooking', 'Trivia', 'Volunteering', 'Book club',
    'Coffee chats', 'Game day'
];

HC.NEIGHBORHOODS = [
    'Alexandria', 'Arlington', 'Bethesda', 'Capitol Hill', 'Columbia Heights',
    'Dupont Circle', 'Georgetown', 'Navy Yard', 'Shaw', 'Silver Spring'
];

HC.HOKIES = [
    { id: 'h1', name: 'Maya Patel', gradYear: 2024, major: 'Industrial & Systems Engineering', neighborhood: 'Arlington',
      interests: ['Running', 'Coffee chats', 'Game day', 'Trivia'],
      bio: 'Moved to Clarendon last summer. Always down for a weekend long run or a watch party.' },
    { id: 'h2', name: 'Jordan Brooks', gradYear: 2025, major: 'Computer Science', neighborhood: 'Navy Yard',
      interests: ['Climbing', 'Gym & lifting', 'Game day'],
      bio: 'Software engineer by day, bouldering most evenings. Looking for a climbing partner.' },
    { id: 'h3', name: 'Aaliyah Johnson', gradYear: 2023, major: 'Public Health', neighborhood: 'Columbia Heights',
      interests: ['Yoga', 'Volunteering', 'Cooking'],
      bio: 'Health policy analyst. I organize a monthly volunteer day, so come along!' },
    { id: 'h4', name: 'Ethan Nguyen', gradYear: 2026, major: 'Finance', neighborhood: 'Dupont Circle',
      interests: ['Cycling', 'Coffee chats', 'Book club'],
      bio: 'Brand new to D.C. and exploring the city by bike.' },
    { id: 'h5', name: 'Sofia Ramirez', gradYear: 2024, major: 'Architecture', neighborhood: 'Capitol Hill',
      interests: ['Hiking', 'Cooking', 'Book club'],
      bio: 'Weekend hikes in Shenandoah, weeknight dinner parties.' },
    { id: 'h6', name: 'Marcus Lee', gradYear: 2022, major: 'Mechanical Engineering', neighborhood: 'Alexandria',
      interests: ['Pickup sports', 'Gym & lifting', 'Game day'],
      bio: 'I run a Sunday pickup soccer game in Old Town. All skill levels welcome.' },
    { id: 'h7', name: 'Hannah Kim', gradYear: 2025, major: 'Psychology', neighborhood: 'Bethesda',
      interests: ['Yoga', 'Running', 'Coffee chats'],
      bio: 'Grad student in Bethesda. Trying to find a running group that isn\'t too intense.' },
    { id: 'h8', name: 'Tyler Washington', gradYear: 2021, major: 'Political Science', neighborhood: 'Shaw',
      interests: ['Trivia', 'Game day', 'Volunteering'],
      bio: 'Hill staffer and captain of the unofficial Hokie trivia team.' },
    { id: 'h9', name: 'Priya Shah', gradYear: 2026, major: 'Biological Sciences', neighborhood: 'Silver Spring',
      interests: ['Hiking', 'Yoga', 'Climbing'],
      bio: 'Just started at a biotech lab. Love being outside on weekends.' },
    { id: 'h10', name: 'Chris Oyelaran', gradYear: 2023, major: 'Business Information Technology', neighborhood: 'Georgetown',
      interests: ['Running', 'Cycling', 'Cooking'],
      bio: 'Training for my first marathon, mostly for the post-run brunch.' }
];

HC.GROUPS = [
    { id: 'g1', name: 'D.C. Hokie Run Club', interest: 'Running', neighborhood: 'Capitol Hill', schedule: 'Saturdays, 8 AM', members: 48,
      description: 'Easy-paced 5K on the National Mall, then coffee. All paces welcome, and walking counts.' },
    { id: 'g2', name: 'Hokie Game Day Watch Parties', interest: 'Game day', neighborhood: 'Arlington', schedule: 'Every VT football game', members: 132,
      description: 'Cheer on the Hokies with fellow alumni at a sports bar in Clarendon. Wear maroon.' },
    { id: 'g3', name: 'Hokies on the Trail', interest: 'Hiking', neighborhood: 'Georgetown', schedule: 'Every other Sunday', members: 61,
      description: 'Day hikes at Great Falls, Rock Creek, and Shenandoah. Carpools leave from Metro stations.' },
    { id: 'g4', name: 'Hokie Yoga in the Park', interest: 'Yoga', neighborhood: 'Dupont Circle', schedule: 'Wednesdays, 6:30 PM', members: 27,
      description: 'Outdoor flow in Dupont Circle park while the weather holds, then indoors at a partner studio.' },
    { id: 'g5', name: 'Hokie Trivia Squad', interest: 'Trivia', neighborhood: 'Shaw', schedule: 'Tuesdays, 7 PM', members: 19,
      description: 'Weekly pub trivia. We haven\'t won yet, but we\'re close.' },
    { id: 'g6', name: 'Hokies Give Back D.C.', interest: 'Volunteering', neighborhood: 'Columbia Heights', schedule: 'Monthly, Saturday mornings', members: 44,
      description: 'Food banks, park cleanups, and tutoring with local nonprofits. Ut Prosim.' },
    { id: 'g7', name: 'Old Town Pickup Soccer', interest: 'Pickup sports', neighborhood: 'Alexandria', schedule: 'Sundays, 10 AM', members: 23,
      description: 'Casual 7v7 on the waterfront. Bring a light and a dark shirt.' }
];

// dayOffset is days from today, so the sample events always look upcoming.
HC.EVENTS = [
    { id: 'e1', groupId: 'g5', title: 'Pub trivia night', category: 'Trivia', dayOffset: 1, time: '19:00',
      place: 'Neighborhood pub on 9th St', neighborhood: 'Shaw', going: 8 },
    { id: 'e2', groupId: 'g4', title: 'Sunset yoga flow', category: 'Yoga', dayOffset: 2, time: '18:30',
      place: 'Dupont Circle park', neighborhood: 'Dupont Circle', going: 9 },
    { id: 'e3', groupId: null, title: 'New-to-D.C. Hokie happy hour', category: 'Social', dayOffset: 3, time: '18:00',
      place: 'Rooftop bar near the Yards', neighborhood: 'Navy Yard', going: 33 },
    { id: 'e4', groupId: 'g1', title: '5K on the National Mall + coffee', category: 'Running', dayOffset: 5, time: '08:00',
      place: 'Lincoln Memorial steps', neighborhood: 'Capitol Hill', going: 14 },
    { id: 'e5', groupId: 'g2', title: 'Hokies football watch party', category: 'Game day', dayOffset: 5, time: '15:30',
      place: 'Sports bar in Clarendon', neighborhood: 'Arlington', going: 57 },
    { id: 'e6', groupId: 'g3', title: 'Great Falls day hike', category: 'Hiking', dayOffset: 6, time: '09:00',
      place: 'Great Falls Park visitor center', neighborhood: 'Georgetown', going: 11 },
    { id: 'e7', groupId: 'g7', title: 'Sunday pickup soccer', category: 'Pickup sports', dayOffset: 6, time: '10:00',
      place: 'Jones Point Park', neighborhood: 'Alexandria', going: 18 },
    { id: 'e8', groupId: 'g6', title: 'Food bank volunteer morning', category: 'Volunteering', dayOffset: 12, time: '09:30',
      place: 'Local food bank warehouse', neighborhood: 'Columbia Heights', going: 16 }
];
