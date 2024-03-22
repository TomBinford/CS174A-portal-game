import { defs, tiny } from './examples/common.js';

const {
    Vector, Vector3, vec, vec3, vec4, color, hex_color, Shader, Matrix, Mat4, Light, Shape, Material, Scene, Texture,
} = tiny;

const { Textured_Phong } = defs;

function clamp(x, min, max) {
    return x < min ? min : (x > max ? max : x);
}

function xyz(vec) {
    return vec3(vec[0], vec[1], vec[2]);
}

class Wall {
    // center and normal are vec4's.
    constructor(center, normal, width, height, material, always_draw = false) {
        this.center = center.length === 4 ? center : vec4(...center, 1);
        this.normal = (normal.length === 4 ? normal : vec4(...normal, 0)).normalized();
        this.width = width;
        this.height = height;
        this.material = material;
        this.always_draw = always_draw;
    }

    draw(context, program_state, square) {
        const scale_mat = Mat4.scale(this.width / 2, this.height / 2, 1);
        const model_transform = Mat4.inverse(Mat4.look_at(xyz(this.center), xyz(this.center.minus(this.normal)), vec3(0, 1, 0))).times(scale_mat);
        square.draw(context, program_state, model_transform, this.material);
    }
}

class Portal extends Wall {
    // Portals are walls but also have a partner they teleport you to (potentially)
    constructor(center, normal, width, height, material_off, material_on) {
        super(center, normal, width, height, material_off);
        this.material_on = material_on;
        // initial value doesn't matter since you could only be spuriously
        // teleported if you were touching the portal at game start.
        this.is_player_in_front = true;
    }

    draw(context, program_state, square, isOn) {
        const scale_mat = Mat4.scale(this.width / 2, this.height / 2, 1);
        const model_transform = Mat4.inverse(Mat4.look_at(xyz(this.center), xyz(this.center.minus(this.normal)), vec3(0, 1, 0))).times(scale_mat);

        if (isOn) {
            square.draw(context, program_state, model_transform, this.material_on);
        } else {
            square.draw(context, program_state, model_transform, this.material);
        }
    }
}

export class PortalGame extends Scene {
    constructor() {
        // constructor(): Scenes begin by populating initial values like the Shapes and Materials they'll need.
        super();

        this.has_initialized = false;

        this.has_pointer_lock = false;

        // At the beginning of our program, load one of each of these shape definitions onto the GPU.
        this.shapes = {
            torus: new defs.Torus(15, 15),
            torus2: new defs.Torus(3, 15),
            circle: new defs.Regular_2D_Polygon(1, 15),
            sphere3: new defs.Subdivision_Sphere(3),
            sphere4: new defs.Subdivision_Sphere(4),
            square: new defs.Square(),
            sky: new defs.Square(),
            head: new defs.Cube(),
        };

        this.shapes.sky.arrays.texture_coord = this.shapes.sky.arrays.texture_coord.map(x => x.times(10));

        // *** Materials
        this.materials = {
            body: new Material(new defs.Phong_Shader(),
                { ambient: 1.0, diffusivity: .6, color: hex_color("#60a000") }),
            head: new Material(new defs.Phong_Shader(),
                { ambient: 1.0, diffusivity: .6, color: hex_color("#ffb600") }),
            asish_texture: new Material(new Textured_Phong(), {
                ambient: 1.0,
                texture: new Texture("assets/asish.jpeg")
            }),
            wall_texture1: new Material(new Textured_Phong(), {
                color: hex_color("#ffffff"),
                ambient: 0.5, diffusivity: 0.5, specularity: 1,
                texture: new Texture("assets/wall-texture1.jpg")
            }),
            wall_texture2: new Material(new Textured_Phong(), {
                color: hex_color("#ffffff"),
                ambient: 0.1, diffusivity: 0.1, specularity: 0.1,
                texture: new Texture("assets/wall-texture2.jpg")
            }),
            floor_texture: new Material(new Textured_Phong(), {
                color: hex_color("#ffffff"),
                ambient: 0.5, diffusivity: 0.1, specularity: 0.1,
                texture: new Texture("assets/floor-texture.jpg")
            }),
            sky_texture: new Material(new Textured_Phong(), {
                ambient: 1.0,
                texture: new Texture("assets/sky-texture.jpg")
            }),
            orange_portal_on: new Material(new Textured_Phong(), {
                ambient: 1.0,
                texture: new Texture("assets/orange-portal-on.png")
            }),
            blue_portal_on: new Material(new Textured_Phong(), {
                ambient: 1.0,
                texture: new Texture("assets/blue-portal-on.png")
            }),
            orange_portal_off: new Material(new Textured_Phong(), {
                ambient: 1.0,
                texture: new Texture("assets/orange-portal-off.png")
            }),
            blue_portal_off: new Material(new Textured_Phong(), {
                ambient: 1.0,
                texture: new Texture("assets/blue-portal-off.png")
            }),
        };

        this.render_portal_view = true;
        // Objects for rendering the portal views to textures.
        this.scratchpad = document.createElement('canvas');
        this.scratchpad.width = 1024;
        this.scratchpad.height = 1024;
        // A hidden canvas for re-sizing the real canvas to be square:
        this.scratchpad_context = this.scratchpad.getContext("2d", { willReadFrequently: true });
        // noinspection SpellCheckingInspection
        const white1x1PixelData = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
        this.texture_through_blue_portal = new Texture(white1x1PixelData);
        this.texture_through_orange_portal = new Texture(white1x1PixelData);
        this.materials.orange_portal_textured = new Material(new Screen_Rendered_Texture(), {
            ambient: 1.0,
            texture: this.materials.orange_portal_on.texture,
            screenTexture: this.texture_through_blue_portal,
        });
        this.materials.blue_portal_textured = new Material(new Screen_Rendered_Texture(), {
            ambient: 1.0,
            texture: this.materials.blue_portal_on.texture,
            screenTexture: this.texture_through_orange_portal,
        });

        this.w_pressed = false;
        this.a_pressed = false;
        this.s_pressed = false;
        this.d_pressed = false;

        this.asish_mode = false;

        // Portal variables
        this.portal_offset_from_wall = 0.01;
        this.max_portaling_distance = 150.0;
        this.requested_portal1_shoot = false;
        this.requested_portal2_shoot = false;
        // Make only one portal to start
        this.portal1 = null;
        //this.portal1 = new Portal(vec4(-15, 1, 25 - this.portal_offset_from_wall, 1), vec4(0, 0, -1, 0), 5, 5, this.materials.orange_portal_off, this.materials.orange_portal_textured);
        this.portal2 = new Portal(vec4(-25 + this.portal_offset_from_wall, 1, 0, 1), vec4(1, 0, 0, 0), 5, 5, this.materials.blue_portal_off, this.materials.blue_portal_textured);

        this.player_speed = 0.015;
        this.player = {
            orientation_up: 0.0,
            orientation_clockwise: 0.0,
            position: vec4(0, 0, 0, 1),
        };
    }

    move_player_from_wasd(time_delta_ms) {
        const w_contribution = this.w_pressed ? vec4(0, 0, -1, 0) : vec4(0, 0, 0, 0);
        const a_contribution = this.a_pressed ? vec4(-1, 0, 0, 0) : vec4(0, 0, 0, 0);
        const s_contribution = this.s_pressed ? vec4(0, 0, 1, 0) : vec4(0, 0, 0, 0);
        const d_contribution = this.d_pressed ? vec4(1, 0, 0, 0) : vec4(0, 0, 0, 0);

        const relative_movement_dir = w_contribution.plus(a_contribution).plus(s_contribution).plus(d_contribution);
        if (relative_movement_dir.norm() > 0) {
            const absolute_movement_dir = Mat4.rotation(this.player.orientation_clockwise, 0, -1, 0).times(relative_movement_dir);
            const distance_moved = this.player_speed * time_delta_ms;
            const position_delta = absolute_movement_dir.normalized().times(distance_moved);
            this.player.position = this.player.position.plus(position_delta);
        }
    }

    // Precondition: point_on_plane_of_wall is on the plane described by plane_normal and plane_center
    is_planar_point_inside_rectangle(rectangle_normal, rectangle_center, width, height, test_point) {
        const p = test_point;
        const point_of_contact_vertical = p[1] - rectangle_center[1];
        const point_of_contact_horizontal = vec3(p[0], 0, p[2]).minus(vec3(rectangle_center[0], 0, rectangle_center[2])).norm();
        const ok_vertical = Math.abs(point_of_contact_vertical) <= height / 2;
        const ok_horizontal = Math.abs(point_of_contact_horizontal) <= width / 2;
        return ok_vertical && ok_horizontal;
    }

    is_planar_point_on_wall(wall, point_on_plane_of_wall) {
        return this.is_planar_point_inside_rectangle(wall.normal, wall.center, wall.width, wall.height, point_on_plane_of_wall);
    }

    // All parameters are vec4's. Returns null if there is no intersection, otherwise the value t
    // such that source + t * ray is on the plane.
    ray_cast_to_plane(plane_normal, point_on_plane, ray, source) {
        // Adapted from https://education.siggraph.org/static/HyperGraph/raytrace/rayplane_intersection.htm
        const D = -plane_normal.dot(point_on_plane);
        const vd = plane_normal.dot(ray);
        if (vd >= 0) return null;
        const v0 = -(plane_normal.dot(source) + D);
        const t = v0 / vd;
        return t >= 0 ? t : null;
    }

    // All parameters are vec4's.
    t_from_plane_to_point(plane_normal, point_on_plane, point) {
        // Adapted from nearest_point_on_plane_to_point
        const relative_point_on_plane = point_on_plane.minus(point);
        return -plane_normal.dot(relative_point_on_plane);
    }

    // All parameters are vec4's.
    nearest_point_on_plane_to_point(plane_normal, point_on_plane, point) {
        // Adapted from https://en.wikipedia.org/wiki/Distance_from_a_point_to_a_plane
        // <x, y, z> = point_on_plane - point
        // d = ax + by + cz, that is d = plane_normal dot <x, y, z>
        // closest_point = normal * d / normal dot normal (but we know normal is a unit vector)
        const relative_point_on_plane = point_on_plane.minus(point);
        const d = plane_normal.dot(relative_point_on_plane);
        const relative_closest_point = plane_normal.times(d);//.times(1 / plane_normal.dot(plane_normal));
        return relative_closest_point.plus(point);
    }

    solve_player_collision(wall, player_radius, player_height) {
        const t = this.t_from_plane_to_point(wall.normal, wall.center, this.player.position);
        if (t < player_radius && t > 0) {
            const radius_component_not_inside_wall = Math.sqrt(player_radius ** 2 - t ** 2);
            const point_of_contact = this.nearest_point_on_plane_to_point(wall.normal, wall.center, this.player.position);
            const point_of_contact_vertical = point_of_contact[1] - wall.center[1];
            const point_of_contact_horizontal = vec3(point_of_contact[0], 0, point_of_contact[2]).minus(vec3(wall.center[0], 0, wall.center[2])).norm();
            const wall_contact_vertical = point_of_contact_vertical <= wall.height / 2
                || point_of_contact_vertical >= wall.height / 2 - player_height;
            const wall_contact_horizontal = Math.abs(point_of_contact_horizontal) <= wall.width / 2 + radius_component_not_inside_wall;
            if (wall_contact_vertical && wall_contact_horizontal) {
                // Player has gone into the wall; need to push them back out.
                return wall.normal.times(-(t - player_radius));
            }
            // Otherwise the player is going around the wall.
        }
        return vec4(0, 0, 0, 0);
    }

    solve_player_collision_portal(in_portal, out_portal, player_radius, player_height) {
        if (!(in_portal && out_portal)) {
            return this.player.position;
        }
        const t = this.t_from_plane_to_point(in_portal.normal, in_portal.center, this.player.position);
        // Teleport only if the player's center has entered the portal.
        const was_player_in_front = in_portal.is_player_in_front;
        in_portal.is_player_in_front = t > 0;
        if (was_player_in_front && !in_portal.is_player_in_front) {
            const point_of_contact = this.nearest_point_on_plane_to_point(in_portal.normal, in_portal.center, this.player.position);
            const point_of_contact_vertical = point_of_contact[1] - in_portal.center[1];
            const point_of_contact_horizontal = vec3(point_of_contact[0], 0, point_of_contact[2]).minus(vec3(in_portal.center[0], 0, in_portal.center[2])).norm();
            const wall_contact_vertical = point_of_contact_vertical <= in_portal.height / 2
                || point_of_contact_vertical >= in_portal.height / 2 - player_height;
            const wall_contact_horizontal = Math.abs(point_of_contact_horizontal) <= in_portal.width / 2;
            if (wall_contact_vertical && wall_contact_horizontal) {
                // Player has gone into the portal; spawn them out on the other side.
                const angle_into_in_portal = Math.PI + Math.atan2(in_portal.normal[0], -in_portal.normal[2]);
                const angle_out_of_out_portal = Math.atan2(out_portal.normal[0], -out_portal.normal[2]);
                const angle_diff = angle_out_of_out_portal - angle_into_in_portal;
                this.player.orientation_clockwise += angle_diff;

                const player_relative_to_in = this.player.position.minus(in_portal.center);
                const player_relative_to_out = Mat4.rotation(angle_diff, 0, -1, 0).times(player_relative_to_in);
                return vec4(out_portal.center[0] + player_relative_to_out[0], 0, out_portal.center[2] + player_relative_to_out[2], 0);//.plus(out_portal.normal);
            }
        }
        return this.player.position;
    }

    // Returns [null, null, Infinity] if the player is not looking at any wall. Otherwise
    //  returns [wall, vec, t], where wall is the closest wall in the direction
    //  the player is looking, vec is a vec4 of the point on the wall the player is looking at,
    //  and t is the distance in their view direction to the wall.
    determine_player_look_at(walls) {
        const player_look_vector = Mat4.rotation(this.player.orientation_clockwise, 0, -1, 0)
            .times(Mat4.rotation(this.player.orientation_up, 1, 0, 0))
            .times(vec4(0, 0, -1, 0));
        let min_t = Infinity;
        let nearest_wall = null;
        let look_at_point = null;
        for (const wall of walls) {
            if (wall.normal.dot(player_look_vector) >= 0) {
                // Only consider walls which the player is looking at the front of.
                continue;
            }
            const t = this.ray_cast_to_plane(wall.normal, wall.center, player_look_vector, this.player.position);
            if (t !== null) {
                const looking_point = this.player.position.plus(player_look_vector.times(t));
                if (this.is_planar_point_on_wall(wall, looking_point) && t < min_t) {
                    min_t = t;
                    nearest_wall = wall;
                    look_at_point = looking_point;
                }
            }
        }
        return [nearest_wall, look_at_point, min_t];
    }

    // Returns null if no portal could be created, otherwise a new Portal object
    // placed on the wall the player shot at.
    try_create_portal(walls, material_off, material_on) {
        let [wall, look_at_point, t] = this.determine_player_look_at(walls);
        if (wall === null || t > this.max_portaling_distance) {
            return null;
        }
        const width = 5.0;
        const height = 5.0;
        if (width > wall.width || height > wall.height) {
            return null;
        }
        // "Smart" portal placement: if the portal would go outside the wall, snap it inside the wall.
        const vertical_dist = look_at_point[1] - wall.center[1];
        // Snap vertically
        if (vertical_dist > wall.height / 2 - height / 2) {
            look_at_point[1] = (wall.center[1] + wall.height / 2) - height / 2;
        } else if (vertical_dist < -wall.height / 2 + height / 2) {
            look_at_point[1] = (wall.center[1] - wall.height / 2) + height / 2;
        }

        const relative_horizontal_pos = vec3(look_at_point[0], 0, look_at_point[2]).minus(vec3(wall.center[0], 0, wall.center[2]));
        const horizontal_dist = xyz(wall.normal).cross(relative_horizontal_pos)[1];
        // Snap horizontally
        if (horizontal_dist < -wall.width / 2 + width / 2) {
            const left_point = wall.center.plus(xyz(wall.normal).cross(vec3(0, wall.width / 2 - width / 2, 0)));
            look_at_point[0] = left_point[0];
            look_at_point[2] = left_point[2];
        } else if (horizontal_dist > wall.width / 2 - width / 2) {
            const right_point = wall.center.plus(xyz(wall.normal).cross(vec3(0, -wall.width / 2 + width / 2, 0)));
            look_at_point[0] = right_point[0];
            look_at_point[2] = right_point[2];
        }

        // At this point, the portal is guaranteed to be on the wall.
        // TODO return null if the new portal would overlap with the existing *other* portal.
        const portal_center = look_at_point.plus(wall.normal.times(this.portal_offset_from_wall));
        return new Portal(portal_center, wall.normal, width, height, material_off, material_on);
    }

    make_control_panel() {
        // Draw the scene's buttons, setup their actions and keyboard shortcuts, and monitor live measurements.
        this.key_triggered_button("switch normal <-> portal view mode", [" "], () => {
            this.render_portal_view = !this.render_portal_view;
        });
        this.key_triggered_button("move forward", ["w"],
            () => {
                this.w_pressed = true;
            }, "#6E6460", () => {
                this.w_pressed = false;
            });
        this.key_triggered_button("move back", ["s"],
            () => {
                this.s_pressed = true;
            }, "#6E6460", () => {
                this.s_pressed = false;
            });
        this.new_line();
        this.key_triggered_button("move left", ["a"],
            () => {
                this.a_pressed = true;
            }, "#6E6460", () => {
                this.a_pressed = false;
            });
        this.key_triggered_button("move right", ["d"],
            () => {
                this.d_pressed = true;
            }, "#6E6460", () => {
                this.d_pressed = false;
            });
        this.new_line();
        this.key_triggered_button("Shoot first portal", ["1"], () => {
            if (this.has_pointer_lock) {
                this.requested_portal1_shoot = true;
            }
        });
        this.key_triggered_button("Shoot second portal", ["2"], () => {
            if (this.has_pointer_lock) {
                this.requested_portal2_shoot = true;
            }
        });
        this.new_line();
        this.key_triggered_button("Toggle Asish Mode", ["Control", "a"], () => {
            this.asish_mode ^= 1;
        });
        this.new_line();
        this.key_triggered_button("Toggle Portal 1", ["Control", "1"], () => {
            this.portal1 = null;
        });
        this.new_line();
        this.key_triggered_button("Toggle Portal 2", ["Control", "2"], () => {
            this.portal2 = null;
        });
        this.new_line();
        this.key_triggered_button("Toggle All Portals", ["x"], () => {
            this.portal1 = null;
            this.portal2 = null;
        });

    }

    // Called the first time display() is called.
    // Only use this for things that can't be done in the constructor - for instance,
    // interacting with DOM elements that don't exist at construction time.
    runtime_initialize() {
        // Mess with the DOM to add a dark overlay saying "Click to play" over the
        // canvas. These cue the player into giving pointer control to the game.
        const container_element = document.createElement("div");
        container_element.style.cssText = "position: relative; width: 1080px; height: 600px;";
        const dark_overlay = document.createElement("div");
        dark_overlay.textContent = "Click to play";
        dark_overlay.style.cssText = `
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            left: 0;
            background: #000;
            color: #fff;
            font-family: "Calibri", sans-serif;
            font-size: 64px;
            text-align: center;
            vertical-align: middle;
            line-height: 600px;
            user-select: none;
            opacity: 0.5;`;
        const canvas_element = document.querySelector(".canvas-widget canvas");
        canvas_element.style.position = "absolute";

        canvas_element.parentNode.prepend(container_element);
        container_element.appendChild(canvas_element);
        container_element.appendChild(dark_overlay);

        let can_attempt_pointer_lock = true;
        dark_overlay.addEventListener("click", () => {
            if (can_attempt_pointer_lock) {
                // The WebStorm warning can be ignored, it's because unadjustedMovement isn't supported everywhere:
                // https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock#browser_compatibility
                dark_overlay.requestPointerLock({ unadjustedMovement: true });
            }
        });
        document.addEventListener("pointerlockchange", () => {
            this.has_pointer_lock = !!document.pointerLockElement;
            if (this.has_pointer_lock) {
                dark_overlay.style.visibility = "hidden";
            } else {
                // The user has disengaged the pointer lock.
                // We get an error if we retry requestPointerLock too quickly (even if the user is responsible by clicking),
                // so wait a while before letting the user try again.
                // (See https://discourse.threejs.org/t/how-to-avoid-pointerlockcontrols-error/33017/5)
                dark_overlay.style.visibility = "visible";
                can_attempt_pointer_lock = false;
                setTimeout(() => {
                    can_attempt_pointer_lock = true;
                }, 1250); // 1250 seems long enough to avoid the error on Chrome
            }
        });
        document.addEventListener("pointerlockerror", () => alert("Pointer lock error"));

        const browser_is_firefox = navigator.userAgent.includes("Firefox");
        dark_overlay.addEventListener("mousemove", (e) => {
            if (this.has_pointer_lock) {
                // e.movementX and e.movementY have inconsistent units between browsers :(
                // This code attempts to account for the table in https://github.com/w3c/pointerlock/issues/42
                // and bring all values to Chrome/Edge's units.
                // On Tom's laptop at both 100% and 200% display scaling it gives results that
                // agree between Chrome and Firefox.
                // TODO test on Safari
                const scaling_factor = browser_is_firefox ? 1 / window.devicePixelRatio : 1.0;
                const movementX = scaling_factor * e.movementX;
                const movementY = scaling_factor * e.movementY;

                const delta_up = movementY * -0.005;
                const delta_clockwise = movementX * 0.005;
                this.player.orientation_up = clamp(this.player.orientation_up + delta_up, -Math.PI / 2, Math.PI / 2);
                this.player.orientation_clockwise += delta_clockwise;
                if (this.player.orientation_clockwise > Math.PI) {
                    this.player.orientation_clockwise -= 2 * Math.PI;
                } else if (this.player.orientation_clockwise < -Math.PI) {
                    this.player.orientation_clockwise += 2 * Math.PI;
                }
            }
        });
    }

    draw_environment(context, program_state) {
        // Draw floor at origin translated down by y = -0.5 units
        const horizontal_angle = Math.PI / 2;

        const floor_transform = Mat4.scale(100, 8, 120).times(Mat4.translation(0, -0.5, 0)).times(Mat4.rotation(horizontal_angle, 1, 0, 0));
        const sky_transform = Mat4.scale(900, 8, 900).times(Mat4.translation(0, 3, 0)).times(Mat4.rotation(horizontal_angle, 1, 0, 0));

        this.shapes.square.draw(context, program_state, floor_transform, this.materials.floor_texture);
        this.shapes.sky.draw(context, program_state, sky_transform, this.materials.sky_texture);
    }

    display(context, program_state) {
        // display():  Called once per frame of animation.
        if (!this.has_initialized) {
            this.runtime_initialize();
            this.has_initialized = true;
        }
        // Pause everything if we don't have the pointer lock.
        program_state.animate = this.has_pointer_lock;

        // Add all walls to this variable
        var game_walls = [];

        // Border walls
        const border_top = new Wall(vec3(0, 0, -120), vec3(0, 0, 1), 200, 10, this.materials.wall_texture1);
        const border_bottom = new Wall(vec3(0, 0, 120), vec3(0, 0, -1), 200, 10, this.materials.wall_texture1);
        const border_left = new Wall(vec3(-100, 0, 0), vec3(1, 0, 0), 240, 10, this.materials.wall_texture1);
        const border_right = new Wall(vec3(100, 0, 0), vec3(-1, 0, 0), 240, 10, this.materials.wall_texture1);
        const border = [border_top, border_bottom, border_left, border_right];
        game_walls = game_walls.concat(border);

        // Test walls forming the center box. Texture depends on whether asish mode is enabled.
        const box_material = this.asish_mode ? this.materials.asish_texture : this.materials.wall_texture2;
        const my_wall = new Wall(vec3(0, -2, -4.5), vec3(0, 0, 1), 3, 3, box_material, true);
        const my_wall2 = new Wall(vec3(0, -2, -7.5), vec3(0, 0, -1), 3, 3, box_material, true);
        const my_wall3 = new Wall(vec3(-1.5, -2, -6), vec3(-1, 0, 0), 3, 3, box_material, true);
        const my_wall4 = new Wall(vec3(1.5, -2, -6), vec3(1, 0, 0), 3, 3, box_material, true);
        const test_walls = [my_wall, my_wall2, my_wall3, my_wall4];
        game_walls = game_walls.concat(test_walls);

        // First room
        const rm1_front1 = new Wall(vec3(-15, 0, -25), vec3(0, 0, 1), 20, 10, this.materials.wall_texture1);
        const rm1_front2 = new Wall(vec3(15, 0, -25), vec3(0, 0, 1), 20, 10, this.materials.wall_texture1);
        const rm1_back = new Wall(vec3(0, 0, 25), vec3(0, 0, -1), 50, 10, this.materials.wall_texture1);
        const rm1_left = new Wall(vec3(-25, 0, 0), vec3(1, 0, 0), 50, 10, this.materials.wall_texture1);
        const rm1_right = new Wall(vec3(25, 0, 0), vec3(-1, 0, 0), 50, 10, this.materials.wall_texture1);
        const rm1 = [rm1_front1, rm1_front2, rm1_back, rm1_left, rm1_right];
        game_walls = game_walls.concat(rm1);

        // First room backwalls
        const rm1_front1_b = new Wall(vec3(-15, 0, -25), vec3(0, 0, -1), 20, 10, this.materials.wall_texture1);
        const rm1_front2_b = new Wall(vec3(15, 0, -25), vec3(0, 0, -1), 20, 10, this.materials.wall_texture1);
        const rm1_back_b = new Wall(vec3(0, 0, 25), vec3(0, 0, 1), 50, 10, this.materials.wall_texture1);
        const rm1_left_b = new Wall(vec3(25, 0, 0), vec3(1, 0, 0), 50, 10, this.materials.wall_texture1);
        const rm1_right_b = new Wall(vec3(-25, 0, 0), vec3(-1, 0, 0), 50, 10, this.materials.wall_texture1);
        const rm1_b = [rm1_front1_b, rm1_front2_b, rm1_back_b, rm1_left_b, rm1_right_b];
        game_walls = game_walls.concat(rm1_b);

        // Second room
        const rm2_front1 = new Wall(vec3(-30, 0, -50), vec3(0, 0, -1), 50, 10, this.materials.wall_texture1);
        const rm2_front2 = new Wall(vec3(15, 0, -50), vec3(0, 0, -1), 20, 10, this.materials.wall_texture1);
        const rm2_left = new Wall(vec3(-25, 0, -75), vec3(1, 0, 0), 50, 10, this.materials.wall_texture1);
        const rm2_right = new Wall(vec3(25, 0, -75), vec3(-1, 0, 0), 50, 10, this.materials.wall_texture1);
        const left_diag = new Wall(vec3(15, 0, -110), vec3(-Math.sqrt(2), 0, Math.sqrt(2)), Math.sqrt(800), 10, this.materials.wall_texture1);
        const right_diag = new Wall(vec3(35, 0, -110), vec3(Math.sqrt(2), 0, Math.sqrt(2)), Math.sqrt(800), 10, this.materials.wall_texture1);
        const rm2 = [rm2_front1, rm2_front2, rm2_left, rm2_right, left_diag, right_diag];
        game_walls = game_walls.concat(rm2);

        // Second room backwalls
        const rm2_front1_b = new Wall(vec3(-30, 0, -50), vec3(0, 0, 1), 50, 10, this.materials.wall_texture1);
        const rm2_front2_b = new Wall(vec3(15, 0, -50), vec3(0, 0, 1), 20, 10, this.materials.wall_texture1);
        const rm2_left_b = new Wall(vec3(-25, 0, -75), vec3(-1, 0, 0), 50, 10, this.materials.wall_texture1);
        const rm2_right_b = new Wall(vec3(25, 0, -75), vec3(1, 0, 0), 50, 10, this.materials.wall_texture1);
        const left_diag_b = new Wall(vec3(15, 0, -110), vec3(Math.sqrt(2), 0, -Math.sqrt(2)), Math.sqrt(800), 10, this.materials.wall_texture1);
        const right_diag_b = new Wall(vec3(35, 0, -110), vec3(-Math.sqrt(2), 0, -Math.sqrt(2)), Math.sqrt(800), 10, this.materials.wall_texture1);
        const rm2_b = [rm2_front1_b, rm2_front2_b, rm2_left_b, rm2_right_b, left_diag_b, right_diag_b];
        game_walls = game_walls.concat(rm2_b);

        // Top lef atrium (+ backwalls)
        const tla_left = new Wall(vec3(-55, 0, -85), vec3(1, 0, 0), 70, 10, this.materials.wall_texture1);
        const tla_left_b = new Wall(vec3(-55, 0, -85), vec3(-1, 0, 0), 70, 10, this.materials.wall_texture1);
        const tla = [tla_left, tla_left_b];
        game_walls = game_walls.concat(tla);

        // Third room
        const rm3_front1 = new Wall(vec3(-15, 0, 75), vec3(0, 0, -1), 20, 10, this.materials.wall_texture1);
        const rm3_front2 = new Wall(vec3(15, 0, 75), vec3(0, 0, -1), 20, 10, this.materials.wall_texture1);
        const rm3_left = new Wall(vec3(-25, 0, 50), vec3(1, 0, 0), 50, 10, this.materials.wall_texture1);
        const rm3_right = new Wall(vec3(25, 0, 50), vec3(-1, 0, 0), 50, 10, this.materials.wall_texture1);
        const rm3 = [rm3_front1, rm3_front2, rm3_left, rm3_right];
        game_walls = game_walls.concat(rm3);

        // Third room backwalls
        const rm3_front1_b = new Wall(vec3(-15, 0, 75), vec3(0, 0, 1), 20, 10, this.materials.wall_texture1);
        const rm3_front2_b = new Wall(vec3(15, 0, 75), vec3(0, 0, 1), 20, 10, this.materials.wall_texture1);
        const rm3_left_b = new Wall(vec3(-25, 0, 50), vec3(-1, 0, 0), 50, 10, this.materials.wall_texture1);
        const rm3_right_b = new Wall(vec3(25, 0, 50), vec3(1, 0, 0), 50, 10, this.materials.wall_texture1);
        const rm3_b = [rm3_front1_b, rm3_front2_b, rm3_left_b, rm3_right_b];
        game_walls = game_walls.concat(rm3_b);

        if (program_state.animate) {
            // PUT ALL UPDATE LOGIC HERE

            const simulate_physics = (time_delta_ms) => {
                this.move_player_from_wasd(time_delta_ms);

                const player_radius = 1.0;
                // Do physics unless the player is inside an open portal, in which case they can move freely.
                let do_wall_physics = true;
                if (this.portal1 && this.portal2) {
                    const inside_portal = (p) => {
                        const t = this.t_from_plane_to_point(p.normal, p.center, this.player.position);
                        if (t < player_radius && t > -player_radius + this.player_speed * time_delta_ms) {
                            // Subtract from width so the player can only walk inside if their whole body is inside the portal.
                            return this.is_planar_point_inside_rectangle(p.normal, p.center, p.width - 2 * player_radius, p.height, this.player.position);
                        }
                        return false;
                    };
                    if (inside_portal(this.portal1) || inside_portal(this.portal2)) {
                        do_wall_physics = false;
                    }
                }
                if (do_wall_physics) {
                    for (const wall of game_walls) {
                        const resolution_force = this.solve_player_collision(wall, player_radius, 2.0);
                        this.player.position = this.player.position.plus(resolution_force);
                    }
                }
                this.player.position = this.solve_player_collision_portal(this.portal1, this.portal2, player_radius, 2.0);
                this.player.position = this.solve_player_collision_portal(this.portal2, this.portal1, player_radius, 2.0);
            };

            // To avoid instability caused by low frame rates, solve physics on smaller time steps.
            let t = program_state.animation_delta_time;
            while (t > 0.0) {
                const time_step = Math.min(t, 10.0); // 10ms is small enough to be unproblematic
                t -= time_step;
                simulate_physics(time_step);
            }

            if (this.requested_portal1_shoot) {
                this.requested_portal1_shoot = false;
                const new_portal = this.try_create_portal(game_walls, this.materials.orange_portal_off, this.materials.orange_portal_textured);
                if (new_portal !== null) {
                    this.portal1 = new_portal;
                }
            }
            if (this.requested_portal2_shoot) {
                this.requested_portal2_shoot = false;
                const new_portal = this.try_create_portal(game_walls, this.materials.blue_portal_off, this.materials.blue_portal_textured);
                if (new_portal !== null) {
                    this.portal2 = new_portal;
                }
            }
        }

        // Create light for the 3-d plane
        const light_position = vec4(0, 0, 0, 1);
        var curr_color = color(1, 1, 1, 1);
        program_state.lights = [new Light(light_position, curr_color, 1)];

        const render_portal_camera_to_texture = (portal_entrance, portal_exit, output_texture) => {
            if (!(this.render_portal_view && portal_entrance && portal_exit)) {
                return;
            }
            // Set the fake camera for looking through the exit portal
            const angle_into_in_portal = Math.PI + Math.atan2(portal_entrance.normal[0], -portal_entrance.normal[2]);
            const angle_out_of_out_portal = Math.atan2(portal_exit.normal[0], -portal_exit.normal[2]);
            const angle_diff = angle_out_of_out_portal - angle_into_in_portal;
            const camera_orientation_clockwise = this.player.orientation_clockwise + angle_diff;
            const pos_diff = this.player.position.minus(portal_entrance.center);
            const camera_position = portal_exit.center.plus(Mat4.rotation(angle_diff, 0, -1, 0).times(pos_diff));
            const camera_look_transform = Mat4.rotation(camera_orientation_clockwise, 0, -1, 0).times(Mat4.rotation(this.player.orientation_up, 1, 0, 0));
            const camera_transform = Mat4.translation(...camera_position).times(camera_look_transform);
            program_state.set_camera(Mat4.inverse(camera_transform));

            const distance_to_portal = portal_entrance.center.minus(this.player.position).norm();

            program_state.projection_transform = Mat4.perspective(
                Math.PI / 4, context.width / context.height, .2 + distance_to_portal, 1000);

            // Draw floor, sky
            this.draw_environment(context, program_state);

            // Draw walls
            for (const wall of game_walls) {
                // Do not draw the back wall of the wall the exit portal is placed on.
                if (wall.normal.dot(portal_exit.normal) < -0.999) {
                    const t = -this.t_from_plane_to_point(wall.normal, wall.center, portal_exit.center);
                    if (Math.abs(t - this.portal_offset_from_wall) < 0.1) {
                        const corresponding_point_to_portal_on_wall = portal_exit.center.minus(portal_exit.normal.times(this.portal_offset_from_wall));
                        if (this.is_planar_point_inside_rectangle(wall.normal, wall.center, wall.width, wall.height, corresponding_point_to_portal_on_wall)) {
                            continue;
                        }
                    }
                }
                if (wall.always_draw) {
                    wall.draw(context, program_state, this.shapes.square);
                    continue;
                }
                // Only draw walls whose front side is facing the camera. This prevents visual artifacts
                // with our pairs of walls with opposite normals and different textures placed close together.
                // Adapted from:https://stackoverflow.com/questions/15688232/check-which-side-of-a-plane-points-are-on
                const d = -wall.center.dot(wall.normal);
                const dot = wall.normal.dot(camera_position) + d;
                if (dot >= 0) {
                    wall.draw(context, program_state, this.shapes.square);
                }
            }

            // Draw the entrance portal but not the exit (as we are already from the POV of it).
            const d = -portal_entrance.center.dot(portal_entrance.normal);
            const dot = portal_entrance.normal.dot(camera_position) + d;
            if (dot >= 0) {
                // TODO fix this to draw less dynamically. It currently has issues when the exit
                // portal can see into the entrance portal.
                portal_entrance.draw(context, program_state, this.shapes.square, portal_exit);
            }

            // Create Body (a sphere below the player transform)
            const player_look_transform = Mat4.rotation(this.player.orientation_clockwise, 0, -1, 0).times(Mat4.rotation(this.player.orientation_up, 1, 0, 0));
            const player_transform = Mat4.translation(...this.player.position).times(player_look_transform);
            const body_transform = player_transform.times(Mat4.translation(0, -1.10, 0));
            this.shapes.sphere3.draw(context, program_state, body_transform, this.materials.body);

            // Create head (a cube above the player transform)
            const head_transform = Mat4.translation(...this.player.position).times(Mat4.translation(0, 0.9, 0));
            this.shapes.head.draw(context, program_state, head_transform, this.materials.head);

            // When the player is looking at a plane, draw a sphere there.
            const [_wall, look_at_point, _look_at_t] = this.determine_player_look_at(game_walls);
            if (look_at_point !== null) {
                const sphere_transform = Mat4.translation(...xyz(look_at_point)).times(Mat4.scale(0.2, 0.2, 0.2));
                this.shapes.sphere3.draw(context, program_state, sphere_transform, this.materials.body.override({ color: hex_color("#ff4040") }));
            }

            // Render from the camera's POV into the texture. This only renders the
            // sub-rectangle that will ultimately be visible inside the portal.
            this.scratchpad_context.drawImage(context.canvas, 0, 0, 1080, 600, 0, 0, this.scratchpad.width, this.scratchpad.height);
            // HACK: TinyGraphics makes Texture.image is an HTMLImageElement, but the WebGL calls made from Texture
            // accept other things for the image data besides an HTMLImageElement. So even though TinyGraphics
            // didn't intend this, we can just set Texture.image to an ImageData instead. This is massively faster
            // than the intended `output_texture.image.src = this.scratchpad.toDataURL("image/png");`.
            output_texture.image = this.scratchpad_context.getImageData(0, 0, this.scratchpad.width, this.scratchpad.height);
            output_texture.copy_onto_graphics_card(context.context, false);

            // Start over on a new drawing, never displaying the prior one:
            context.context.clear(context.context.COLOR_BUFFER_BIT | context.context.DEPTH_BUFFER_BIT);
        };

        render_portal_camera_to_texture(this.portal1, this.portal2, this.texture_through_blue_portal);
        render_portal_camera_to_texture(this.portal2, this.portal1, this.texture_through_orange_portal);

        // Set the real camera for the player POV
        program_state.projection_transform = Mat4.perspective(
            Math.PI / 4, context.width / context.height, .1, 1000);
        const player_look_transform = Mat4.rotation(this.player.orientation_clockwise, 0, -1, 0).times(Mat4.rotation(this.player.orientation_up, 1, 0, 0));
        const player_transform = Mat4.translation(...this.player.position).times(player_look_transform);
        program_state.set_camera(Mat4.inverse(player_transform));

        // Draw floor, sky
        this.draw_environment(context, program_state);

        // Draw walls
        for (const wall of game_walls) {
            if (wall.always_draw) {
                wall.draw(context, program_state, this.shapes.square);
                continue;
            }
            // Only draw walls whose front side is facing the player. This prevents visual artifacts
            // with our pairs of walls with opposite normals and different textures placed close together.
            // Adapted from:https://stackoverflow.com/questions/15688232/check-which-side-of-a-plane-points-are-on
            const d = -wall.center.dot(wall.normal);
            const dot = wall.normal.dot(this.player.position) + d;
            if (dot >= 0) {
                wall.draw(context, program_state, this.shapes.square);
            }
        }

        // Draw portals
        if (this.portal1) {
            this.portal1.draw(context, program_state, this.shapes.square, this.portal2);
        }
        if (this.portal2) {
            this.portal2.draw(context, program_state, this.shapes.square, this.portal1);
        }

        // Create Body (A sphere below the player/camera transform)
        const body_transform = Mat4.translation(...this.player.position).times(Mat4.translation(0, -1.2, 0));
        this.shapes.sphere3.draw(context, program_state, body_transform, this.materials.body);

        // When the player is looking at a plane, draw a sphere there.
        const [_wall, look_at_point, _look_at_t] = this.determine_player_look_at(game_walls);
        if (look_at_point !== null) {
            const sphere_transform = Mat4.translation(...xyz(look_at_point)).times(Mat4.scale(0.2, 0.2, 0.2));
            this.shapes.sphere3.draw(context, program_state, sphere_transform, this.materials.body.override({ color: hex_color("#ff4040") }));
        }
    }
}

class Screen_Rendered_Texture extends Textured_Phong {
    vertex_glsl_code() {
        // ********* VERTEX SHADER *********
        return this.shared_glsl_code() + `
                varying vec2 f_tex_coord;
                attribute vec3 position, normal;
                // Position is expressed in object coordinates.
                attribute vec2 texture_coord;

                uniform mat4 model_transform;
                uniform mat4 projection_camera_model_transform;

                void main(){
                    // The vertex's final resting place (in NDCS):
                    gl_Position = projection_camera_model_transform * vec4( position, 1.0 );
                    // The final normal vector in screen space.
                    N = normalize( mat3( model_transform ) * normal / squared_scale);
                    vertex_worldspace = ( model_transform * vec4( position, 1.0 ) ).xyz;
                    // Turn the per-vertex texture coordinate into an interpolated variable.
                    f_tex_coord = texture_coord;
                  } `;
    }

    fragment_glsl_code() {
        // ********* FRAGMENT SHADER *********
        // A fragment is a pixel that's overlapped by the current triangle.
        // Fragments affect the final image or get discarded due to depth.
        return this.shared_glsl_code() + `
                varying vec2 f_tex_coord;
                uniform sampler2D texture;
                uniform sampler2D screenTexture;
                uniform float screen_width;
                uniform float screen_height;

                void main(){
                    vec4 tex_color = texture2D( texture, f_tex_coord );
                    if( max(tex_color.x, max(tex_color.y, tex_color.z)) <= 0.1 && tex_color.w == 1.0 ) {
                        tex_color.xyz *= tex_color.w;
                        // Use the fragment's position in screen space to select from screenTexture.
                        //tex_color.xyz += (1.0 - tex_color.w) * texture2D( screenTexture, vec2(gl_FragCoord.x / screen_width, gl_FragCoord.y / screen_height) ).xyz;
                        tex_color.xyz = texture2D( screenTexture, vec2(gl_FragCoord.x / screen_width, gl_FragCoord.y / screen_height) ).xyz;
                        gl_FragColor = vec4(tex_color.xyz, 1.0);
                    }
                    else {
                        //if( tex_color.w < .01 ) discard;
                                                                                 // Compute an initial (ambient) color:
                        gl_FragColor = vec4( ( tex_color.xyz + shape_color.xyz ) * ambient, shape_color.w * tex_color.w );
                                                                                 // Compute the final color with contributions from lights:
                        gl_FragColor.xyz += phong_model_lights( normalize( N ), vertex_worldspace );
                    }
                  } `;
    }

    update_GPU(context, gpu_addresses, gpu_state, model_transform, material) {
        // update_GPU(): Add a little more to the base class's version of this method.
        super.update_GPU(context, gpu_addresses, gpu_state, model_transform, material);

        context.uniform1f(gpu_addresses.screen_width, 1080.0);
        context.uniform1f(gpu_addresses.screen_height, 600.0);

        if (material.screenTexture && material.screenTexture.ready) {
            // Select texture unit 1 for the fragment shader Sampler2D uniform called "screenTexture":
            context.uniform1i(gpu_addresses.screenTexture, 1);
            // For this draw, use the texture image from correct the GPU buffer:
            material.screenTexture.activate(context, 1);
        }
    }
}
