from pydantic import BaseModel, Field


class Lead(BaseModel):
    full_name_ar: str = Field("", description="الاسم الكامل بالعربية (إن وجد) وإلا فارغ")
    full_name_en: str = Field("", description="Full name in English if available, else empty")
    job_title: str = Field("", description="Job title as printed (Arabic and/or English)")
    company_name: str = Field("", description="Company/organization name (Arabic / English as printed)")
    industry_category: str = Field(
        "", description="Business sector, inferred from company name/logo/title if not written"
    )
    primary_phone: str = Field("", description="Main phone, international format when country is known")
    secondary_phones: list[str] = Field(default_factory=list, description="All other phone numbers")
    email: str = ""
    website: str = ""
    city_country: str = Field("", description="City - Country, e.g. مكة المكرمة - السعودية")
    full_address: str = ""
    card_type: str = Field("Business Card", description="Business Card | Exhibition Badge | Brochure")
    notes: str = Field("", description="Extra details: WhatsApp markers, services, slogan, uncertainty flags")


class ScanResult(BaseModel):
    leads: list[Lead]
