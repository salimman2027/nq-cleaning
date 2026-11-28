"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkArea = checkArea;
const db_1 = require("../db");
const errors_1 = require("../errors");
/**
 * A request must be inside the company's service areas. A company that has not listed any area yet is not restricted
 * (older accounts); new companies cannot be submitted for review without areas.
 */
async function checkArea(companyId, city, district) {
    const rows = await (0, db_1.query)(`SELECT City, District FROM CompanyAreas WHERE CompanyId=@c`, { c: companyId });
    if (rows.length === 0)
        return { city: city ?? null, district: district ?? null };
    if (!city)
        throw new errors_1.HttpError(400, 'OUT_OF_AREA', 'Choose a city this company serves');
    const inCity = rows.filter((r) => r.City === city);
    if (inCity.length === 0)
        throw new errors_1.HttpError(400, 'OUT_OF_AREA', 'This company does not serve that city');
    const districts = inCity.filter((r) => r.District).map((r) => r.District);
    if (districts.length > 0) {
        if (!district)
            throw new errors_1.HttpError(400, 'OUT_OF_AREA', 'Choose a district');
        if (!districts.includes(district))
            throw new errors_1.HttpError(400, 'OUT_OF_AREA', 'This company does not serve that district');
    }
    return { city, district: district ?? null };
}
