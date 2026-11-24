'use strict';
// Public search terms and action wording are curated, never copied from user text.
const MARKETS=Object.freeze({SG:'Singapore',MY:'Malaysia',ID:'Indonesia',TH:'Thailand',VN:'Vietnam',CN:'China',US:'United States',EU:'European Union'});
const PRIORITIES=Object.freeze({continuity:'Operational continuity',liquidity:'Funding and liquidity',compliance:'Compliance checks',costs:'Operating costs',demand:'Customer demand',cybersecurity:'Cybersecurity'});
const definitions=[
  {
    "key": "logistics",
    "label": "Logistics and freight",
    "topic": "logistics and transport",
    "operations": {
      "ocean_freight": "Ocean freight and carrier bookings",
      "cross_border_delivery": "Cross-border delivery and customs",
      "warehouse": "Warehousing and fulfilment"
    },
    "actions": {
      "review_shipping_routes": "Ask the logistics manager to review affected shipping routes, transit buffers and alternative carriers before promising delivery dates.",
      "check_freight_terms": "Check carrier surcharge clauses, customs documents and customer delivery terms before accepting revised freight costs."
    },
    "markets": [
      "SG",
      "MY",
      "CN"
    ],
    "priorities": [
      "continuity",
      "costs"
    ]
  },
  {
    "key": "technology",
    "label": "Technology and cloud services",
    "topic": "technology and software",
    "operations": {
      "cloud_services": "Cloud hosting and managed services",
      "software_delivery": "Business software delivery",
      "data_processing": "Customer data processing"
    },
    "actions": {
      "review_cloud_continuity": "Ask the service owner to check affected cloud dependencies, backup restoration and customer continuity commitments.",
      "review_vendor_security": "Ask the security lead to verify the official vendor advisory, affected products and required mitigations before changing access or software."
    },
    "markets": [
      "SG",
      "US"
    ],
    "priorities": [
      "cybersecurity",
      "continuity"
    ]
  },
  {
    "key": "manufacturing",
    "label": "Manufacturing and electronics",
    "topic": "manufacturing and engineering",
    "operations": {
      "component_sourcing": "Electronic component sourcing",
      "factory_production": "Factory production and contract assembly",
      "export_orders": "Export orders and supplier lead times"
    },
    "actions": {
      "review_component_supply": "Ask procurement to confirm affected component lead times, alternative approved suppliers and production dependencies.",
      "review_inventory_buffers": "Review stock cover and contractual delivery milestones with the production team before changing order commitments."
    },
    "markets": [
      "SG",
      "CN",
      "MY"
    ],
    "priorities": [
      "continuity",
      "costs"
    ]
  },
  {
    "key": "wholesale",
    "label": "Wholesale import and export",
    "topic": "retail and wholesale trade",
    "operations": {
      "import_distribution": "Imported goods and local distribution",
      "trade_documents": "Cross-border trade documents",
      "overseas_suppliers": "Overseas supplier contracts"
    },
    "actions": {
      "review_trade_documents": "Ask the trade operations lead to verify applicable customs rules, product classifications and shipment documents with the relevant official source.",
      "review_supplier_terms": "Review supplier concentration, currency clauses and delivery terms; verify changed beneficiary details independently before any payment."
    },
    "markets": [
      "SG",
      "CN",
      "ID"
    ],
    "priorities": [
      "compliance",
      "liquidity"
    ]
  },
  {
    "key": "hospitality",
    "label": "Food and hospitality",
    "topic": "food and hospitality",
    "operations": {
      "food_supply": "Food procurement and cold-chain supply",
      "hospitality_operations": "Restaurant and hospitality operations",
      "visitor_demand": "Visitor demand and corporate bookings"
    },
    "actions": {
      "review_food_supply": "Ask procurement to check affected ingredients, cold-chain dependencies and approved alternative suppliers against official food advisories.",
      "review_hospitality_costs": "Review supplier contracts, energy costs and staffing assumptions before changing menu prices or accepting large event commitments."
    },
    "markets": [
      "SG",
      "MY"
    ],
    "priorities": [
      "costs",
      "demand"
    ]
  },
  {
    "key": "construction",
    "label": "Construction and property services",
    "topic": "construction and property",
    "operations": {
      "project_delivery": "Construction project delivery",
      "subcontractors": "Subcontractor coordination",
      "material_procurement": "Building-material procurement"
    },
    "actions": {
      "review_project_milestones": "Ask the project manager to check affected site milestones, subcontractor dependencies and contractual notification duties.",
      "review_material_costs": "Review material lead times, escalation clauses and approved substitutes with procurement before committing to revised project budgets."
    },
    "markets": [
      "SG",
      "MY"
    ],
    "priorities": [
      "continuity",
      "liquidity"
    ]
  },
  {
    "key": "healthcare",
    "label": "Healthcare and medical supplies",
    "topic": "healthcare",
    "operations": {
      "medical_distribution": "Medical-device and healthcare distribution",
      "regulated_products": "Regulated product sourcing",
      "sensitive_data": "Healthcare customer information"
    },
    "actions": {
      "review_product_notices": "Ask the compliance owner to confirm the exact product, batch, licence and jurisdiction against the official health-regulator notice.",
      "review_medical_supply": "Check affected product availability, approved alternatives and delivery commitments with qualified procurement and compliance staff."
    },
    "markets": [
      "SG",
      "US",
      "EU"
    ],
    "priorities": [
      "compliance",
      "continuity"
    ]
  },
  {
    "key": "energy",
    "label": "Energy and utilities services",
    "topic": "energy and utilities",
    "operations": {
      "renewable_projects": "Renewable-energy project delivery",
      "energy_contracts": "Energy supply and service contracts",
      "equipment_sourcing": "Energy equipment and maintenance sourcing"
    },
    "actions": {
      "review_energy_contracts": "Ask the commercial manager to review affected energy-contract clauses, supplier dependencies and customer continuity commitments.",
      "review_energy_projects": "Check equipment lead times, project milestones and applicable permit requirements with the engineering and compliance owners."
    },
    "markets": [
      "SG",
      "CN",
      "MY"
    ],
    "priorities": [
      "costs",
      "continuity"
    ]
  },
  {
    "key": "general",
    "label": "General business",
    "topic": "general business",
    "operations": {
      "business_operations": "Business operations",
      "supplier_management": "Supplier management",
      "customer_delivery": "Customer delivery commitments"
    },
    "actions": {},
    "markets": [
      "SG"
    ],
    "priorities": [
      "continuity",
      "compliance"
    ]
  }
];
const SOURCE_DOMAINS=Object.freeze({
 logistics:['gov.sg','maersk.com','cma-cgm.com','globalpsa.com'],
 technology:['gov.sg','cisa.gov','microsoft.com','aws.amazon.com'],
 manufacturing:['gov.sg','ti.com','nxp.com','infineon.com'],
 wholesale:['gov.sg','wto.org','asean.org'],
 hospitality:['gov.sg'],construction:['gov.sg'],
 healthcare:['gov.sg','who.int','fda.gov','ema.europa.eu'],
 energy:['gov.sg','iea.org'],general:['gov.sg','imf.org']
});
for(const profile of definitions){
 profile.sourceDomains=Object.freeze(SOURCE_DOMAINS[profile.key]);
 profile.defaults={markets:profile.markets,priorities:profile.priorities,operations:Object.keys(profile.operations).slice(0,2)};
 Object.freeze(profile.operations);Object.freeze(profile.actions);Object.freeze(profile.defaults);Object.freeze(profile);
}
const PROFILES=Object.freeze(Object.fromEntries(definitions.map(profile=>[profile.key,profile])));
function forIndustry(industry){
 const topic=require('./counterparty-news').industryTopic(industry);
 return definitions.find(profile=>profile.topic===topic)||PROFILES.general;
}
const ACTIONS=Object.freeze(Object.assign({},...definitions.map(profile=>profile.actions)));
module.exports={PROFILES,MARKETS,PRIORITIES,ACTIONS,forIndustry};
