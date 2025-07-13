import Joi from "joi";
import { BadRequestError } from "../../utils/apiError.js";

const assignPermissionSchema = Joi.object({
  roleId: Joi.string().uuid().required(),
  permissionId: Joi.string().uuid().required(),
});

const removePermissionSchema = assignPermissionSchema;

export function validate(data, schemaType) {
  let schema;
  switch (schemaType) {
    case "assignPermissionSchema":
      schema = assignPermissionSchema;
      break;
    case "removePermissionSchema":
      schema = removePermissionSchema;
      break;
    default:
      throw new BadRequestError("Invalid validation schema");
  }

  const { error } = schema.validate(data);
  if (error) throw new BadRequestError(error.details[0].message);
}
