import { query } from '../db';
import { HttpError } from '../errors';

/**
 * A request must be inside the company's service areas. A company that has not listed any area yet is not restricted
 * (older accounts); new companies cannot be submitted for review without areas.
 */
export async function checkArea(companyId: number, city: string | undefined, district: string | undefined): Promise<{ city: string | null; district: string | null }> {
  const rows = await query<{ City: string; District: string | null }>(`SELECT City, District FROM CompanyAreas WHERE CompanyId=@c`, { c: companyId });
  if (rows.length === 0) return { city: city ?? null, district: district ?? null };
  if (!city) throw new HttpError(400, 'OUT_OF_AREA', 'Choose a city this company serves');
  const inCity = rows.filter((r) => r.City === city);
  if (inCity.length === 0) throw new HttpError(400, 'OUT_OF_AREA', 'This company does not serve that city');
  const districts = inCity.filter((r) => r.District).map((r) => r.District as string);
  if (districts.length > 0) {
    if (!district) throw new HttpError(400, 'OUT_OF_AREA', 'Choose a district');
    if (!districts.includes(district)) throw new HttpError(400, 'OUT_OF_AREA', 'This company does not serve that district');
  }
  return { city, district: district ?? null };
}
