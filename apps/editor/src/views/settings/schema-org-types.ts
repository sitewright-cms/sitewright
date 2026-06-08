/**
 * A curated list of schema.org `@type`s suitable for an organization's `businessType` (the value
 * emitted as the JSON-LD `@type`; see packages/blocks/src/head.ts). The `type` is the EXACT
 * schema.org identifier (PascalCase) — it must be spelled correctly to produce valid structured
 * data. `label` is the human display name; `group` buckets them for browsing.
 *
 * Not exhaustive (schema.org's LocalBusiness tree has ~70 leaves) but covers the common cases; the
 * field still accepts any string, so an unusual type can be typed directly. `Organization` is the
 * default when unset; the sentinel `disabled` suppresses JSON-LD entirely.
 */
export interface SchemaOrgType {
  type: string;
  label: string;
  group: string;
}

export const SCHEMA_ORG_TYPES: readonly SchemaOrgType[] = [
  // General
  { type: 'Organization', label: 'Organization (general)', group: 'General' },
  { type: 'Corporation', label: 'Corporation', group: 'General' },
  { type: 'LocalBusiness', label: 'Local business', group: 'General' },
  { type: 'OnlineBusiness', label: 'Online business', group: 'General' },
  { type: 'OnlineStore', label: 'Online store', group: 'General' },
  { type: 'ProfessionalService', label: 'Professional service', group: 'General' },
  { type: 'NGO', label: 'NGO / non-profit', group: 'General' },
  { type: 'GovernmentOrganization', label: 'Government organization', group: 'General' },
  { type: 'EducationalOrganization', label: 'Educational organization', group: 'General' },
  { type: 'NewsMediaOrganization', label: 'News / media organization', group: 'General' },
  { type: 'SportsOrganization', label: 'Sports organization', group: 'General' },
  { type: 'ResearchOrganization', label: 'Research organization', group: 'General' },

  // Food & drink
  { type: 'Restaurant', label: 'Restaurant', group: 'Food & drink' },
  { type: 'FastFoodRestaurant', label: 'Fast-food restaurant', group: 'Food & drink' },
  { type: 'CafeOrCoffeeShop', label: 'Café / coffee shop', group: 'Food & drink' },
  { type: 'Bakery', label: 'Bakery', group: 'Food & drink' },
  { type: 'BarOrPub', label: 'Bar / pub', group: 'Food & drink' },
  { type: 'Brewery', label: 'Brewery', group: 'Food & drink' },
  { type: 'Winery', label: 'Winery', group: 'Food & drink' },
  { type: 'Distillery', label: 'Distillery', group: 'Food & drink' },
  { type: 'IceCreamShop', label: 'Ice-cream shop', group: 'Food & drink' },
  { type: 'Caterer', label: 'Caterer', group: 'Food & drink' },
  { type: 'FoodEstablishment', label: 'Food establishment (other)', group: 'Food & drink' },

  // Retail / store
  { type: 'Store', label: 'Store (general)', group: 'Retail' },
  { type: 'ClothingStore', label: 'Clothing store', group: 'Retail' },
  { type: 'GroceryStore', label: 'Grocery store', group: 'Retail' },
  { type: 'ConvenienceStore', label: 'Convenience store', group: 'Retail' },
  { type: 'DepartmentStore', label: 'Department store', group: 'Retail' },
  { type: 'ElectronicsStore', label: 'Electronics store', group: 'Retail' },
  { type: 'BookStore', label: 'Book store', group: 'Retail' },
  { type: 'Florist', label: 'Florist', group: 'Retail' },
  { type: 'FurnitureStore', label: 'Furniture store', group: 'Retail' },
  { type: 'GardenStore', label: 'Garden store', group: 'Retail' },
  { type: 'HardwareStore', label: 'Hardware store', group: 'Retail' },
  { type: 'HobbyShop', label: 'Hobby shop', group: 'Retail' },
  { type: 'HomeGoodsStore', label: 'Home-goods store', group: 'Retail' },
  { type: 'JewelryStore', label: 'Jewelry store', group: 'Retail' },
  { type: 'LiquorStore', label: 'Liquor store', group: 'Retail' },
  { type: 'MobilePhoneStore', label: 'Mobile-phone store', group: 'Retail' },
  { type: 'MusicStore', label: 'Music store', group: 'Retail' },
  { type: 'OfficeEquipmentStore', label: 'Office-equipment store', group: 'Retail' },
  { type: 'PetStore', label: 'Pet store', group: 'Retail' },
  { type: 'ShoeStore', label: 'Shoe store', group: 'Retail' },
  { type: 'SportingGoodsStore', label: 'Sporting-goods store', group: 'Retail' },
  { type: 'ToyStore', label: 'Toy store', group: 'Retail' },
  { type: 'BikeStore', label: 'Bike store', group: 'Retail' },
  { type: 'TireShop', label: 'Tire shop', group: 'Retail' },
  { type: 'WholesaleStore', label: 'Wholesale store', group: 'Retail' },

  // Health & beauty
  { type: 'MedicalBusiness', label: 'Medical business (general)', group: 'Health & beauty' },
  { type: 'Physician', label: 'Physician', group: 'Health & beauty' },
  { type: 'Dentist', label: 'Dentist', group: 'Health & beauty' },
  { type: 'Hospital', label: 'Hospital', group: 'Health & beauty' },
  { type: 'MedicalClinic', label: 'Medical clinic', group: 'Health & beauty' },
  { type: 'Pharmacy', label: 'Pharmacy', group: 'Health & beauty' },
  { type: 'Optician', label: 'Optician', group: 'Health & beauty' },
  { type: 'Physiotherapy', label: 'Physiotherapy', group: 'Health & beauty' },
  { type: 'VeterinaryCare', label: 'Veterinary care', group: 'Health & beauty' },
  { type: 'HealthAndBeautyBusiness', label: 'Health & beauty (general)', group: 'Health & beauty' },
  { type: 'BeautySalon', label: 'Beauty salon', group: 'Health & beauty' },
  { type: 'HairSalon', label: 'Hair salon', group: 'Health & beauty' },
  { type: 'NailSalon', label: 'Nail salon', group: 'Health & beauty' },
  { type: 'DaySpa', label: 'Day spa', group: 'Health & beauty' },
  { type: 'TattooParlor', label: 'Tattoo parlor', group: 'Health & beauty' },
  { type: 'HealthClub', label: 'Health club / gym', group: 'Health & beauty' },

  // Professional & financial
  { type: 'LegalService', label: 'Legal service', group: 'Professional & financial' },
  { type: 'Attorney', label: 'Attorney', group: 'Professional & financial' },
  { type: 'Notary', label: 'Notary', group: 'Professional & financial' },
  { type: 'AccountingService', label: 'Accounting service', group: 'Professional & financial' },
  { type: 'FinancialService', label: 'Financial service', group: 'Professional & financial' },
  { type: 'BankOrCreditUnion', label: 'Bank / credit union', group: 'Professional & financial' },
  { type: 'InsuranceAgency', label: 'Insurance agency', group: 'Professional & financial' },
  { type: 'RealEstateAgent', label: 'Real-estate agent', group: 'Professional & financial' },
  { type: 'EmploymentAgency', label: 'Employment agency', group: 'Professional & financial' },
  { type: 'TravelAgency', label: 'Travel agency', group: 'Professional & financial' },

  // Home & trades
  { type: 'HomeAndConstructionBusiness', label: 'Home & construction (general)', group: 'Home & trades' },
  { type: 'GeneralContractor', label: 'General contractor', group: 'Home & trades' },
  { type: 'Electrician', label: 'Electrician', group: 'Home & trades' },
  { type: 'Plumber', label: 'Plumber', group: 'Home & trades' },
  { type: 'HVACBusiness', label: 'HVAC business', group: 'Home & trades' },
  { type: 'HousePainter', label: 'House painter', group: 'Home & trades' },
  { type: 'RoofingContractor', label: 'Roofing contractor', group: 'Home & trades' },
  { type: 'Locksmith', label: 'Locksmith', group: 'Home & trades' },
  { type: 'MovingCompany', label: 'Moving company', group: 'Home & trades' },
  { type: 'DryCleaningOrLaundry', label: 'Dry-cleaning / laundry', group: 'Home & trades' },
  { type: 'SelfStorage', label: 'Self storage', group: 'Home & trades' },
  { type: 'ChildCare', label: 'Child care', group: 'Home & trades' },

  // Automotive
  { type: 'AutomotiveBusiness', label: 'Automotive (general)', group: 'Automotive' },
  { type: 'AutoDealer', label: 'Auto dealer', group: 'Automotive' },
  { type: 'AutoRepair', label: 'Auto repair', group: 'Automotive' },
  { type: 'AutoBodyShop', label: 'Auto body shop', group: 'Automotive' },
  { type: 'AutoPartsStore', label: 'Auto-parts store', group: 'Automotive' },
  { type: 'AutoRental', label: 'Auto rental', group: 'Automotive' },
  { type: 'AutoWash', label: 'Auto wash', group: 'Automotive' },
  { type: 'GasStation', label: 'Gas station', group: 'Automotive' },
  { type: 'MotorcycleDealer', label: 'Motorcycle dealer', group: 'Automotive' },

  // Lodging
  { type: 'LodgingBusiness', label: 'Lodging (general)', group: 'Lodging' },
  { type: 'Hotel', label: 'Hotel', group: 'Lodging' },
  { type: 'Motel', label: 'Motel', group: 'Lodging' },
  { type: 'BedAndBreakfast', label: 'Bed & breakfast', group: 'Lodging' },
  { type: 'Hostel', label: 'Hostel', group: 'Lodging' },
  { type: 'Resort', label: 'Resort', group: 'Lodging' },
  { type: 'Campground', label: 'Campground', group: 'Lodging' },

  // Arts, entertainment & recreation
  { type: 'EntertainmentBusiness', label: 'Entertainment (general)', group: 'Arts & recreation' },
  { type: 'ArtGallery', label: 'Art gallery', group: 'Arts & recreation' },
  { type: 'Museum', label: 'Museum', group: 'Arts & recreation' },
  { type: 'MovieTheater', label: 'Movie theater', group: 'Arts & recreation' },
  { type: 'NightClub', label: 'Night club', group: 'Arts & recreation' },
  { type: 'Casino', label: 'Casino', group: 'Arts & recreation' },
  { type: 'AmusementPark', label: 'Amusement park', group: 'Arts & recreation' },
  { type: 'BowlingAlley', label: 'Bowling alley', group: 'Arts & recreation' },
  { type: 'GolfCourse', label: 'Golf course', group: 'Arts & recreation' },
  { type: 'StadiumOrArena', label: 'Stadium / arena', group: 'Arts & recreation' },
  { type: 'TouristAttraction', label: 'Tourist attraction', group: 'Arts & recreation' },
  { type: 'Zoo', label: 'Zoo', group: 'Arts & recreation' },
  { type: 'Library', label: 'Library', group: 'Arts & recreation' },

  // Education
  { type: 'School', label: 'School', group: 'Education' },
  { type: 'Preschool', label: 'Preschool', group: 'Education' },
  { type: 'ElementarySchool', label: 'Elementary school', group: 'Education' },
  { type: 'MiddleSchool', label: 'Middle school', group: 'Education' },
  { type: 'HighSchool', label: 'High school', group: 'Education' },
  { type: 'CollegeOrUniversity', label: 'College / university', group: 'Education' },

  // Civic & government
  { type: 'GovernmentOffice', label: 'Government office', group: 'Civic & government' },
  { type: 'PostOffice', label: 'Post office', group: 'Civic & government' },
  { type: 'PoliceStation', label: 'Police station', group: 'Civic & government' },
  { type: 'FireStation', label: 'Fire station', group: 'Civic & government' },
  { type: 'CityHall', label: 'City hall', group: 'Civic & government' },
];
