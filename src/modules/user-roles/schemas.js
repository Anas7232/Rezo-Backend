import Joi from "joi";
import { BadRequestError } from "../../utils/apiError.js";

const assignRoleSchema = Joi.object({
    userId: Joi.string().uuid().required(),
    roleId: Joi.string().uuid().required(),
});

const removeRoleSchema = assignRoleSchema;

export function validate(data, schemaType) {
    let schema;
    switch (schemaType) {
        case "assignRoleSchema":
            schema = assignRoleSchema;
            break;
        case "removeRoleSchema":
            schema = removeRoleSchema;
            break;
        default:
            throw new BadRequestError("Invalid validation schema");
    }

    const { error } = schema.validate(data);
    if (error) throw new BadRequestError(error.details[0].message);
}
