import {defs, tiny} from './examples/common.js';

const {
    Vector, Vector3, vec, vec3, vec4, color, hex_color, Shader, Matrix, Mat4, Light, Shape, Material, Scene, Texture,
} = tiny;

const {Textured_Phong} = defs

function clamp(x, min, max) {
    return x < min ? min : (x > max ? max : x);
}

function xyz(vec) {
    return vec3(vec[0], vec[1], vec[2]);
}

class Wall {
    // center and normal are vec4's.
    constructor(center, normal, width, height, material) {
        this.center = center;
        this.width = width;
        this.height = height;
        this.normal = normal.normalized();
        this.material = material;
    }

    draw(context, program_state, square) {
        const scale_mat = Mat4.scale(this.width / 2, this.height / 2, 1);
        const model_transform = Mat4.inverse(Mat4.look_at(xyz(this.center), xyz(this.center.plus(this.normal)), vec3(0, 1, 0))).times(scale_mat);
        square.draw(context, program_state, model_transform, this.material);
    }
}

class Portal extends Wall {
    // Portals are walls but also have a partner they teleport you to (potentially)
    constructor(center, normal, width, height, material_off, material_on) {
        super(center, normal, width, height, material_off);
        this.material_on = material_on;
    }

    draw(context, program_state, square, isOn) {
        const scale_mat = Mat4.scale(this.width / 2, this.height / 2, 1);
        const model_transform = Mat4.inverse(Mat4.look_at(xyz(this.center), xyz(this.center.plus(this.normal)), vec3(0, 1, 0))).times(scale_mat);

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
        };

        // *** Materials
        this.materials = {
            test: new Material(new defs.Phong_Shader(),
                {ambient: 1.0, diffusivity: .6, color: hex_color("#60a000")}),
            wall: new Material(new defs.Phong_Shader(),
                {ambient: 1.0, diffusivity: .6, color: hex_color("#0083a0")}),
            bwall: new Material(new defs.Phong_Shader(),
                {ambient: 1.0, diffusivity: .6, color: hex_color("#7800a0")}),
            asish_texture: new Material(new Textured_Phong(), {
                color: hex_color("#ffffff"),
                ambient: 0.5, diffusivity: 0.1, specularity: 0.1,
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
            orange_portal_on: new Material(new Textured_Phong(), {
                color: hex_color("#000000"),
                ambient: 1.0, diffusivity: 0.5, specularity: 0.5,
                texture: new Texture("assets/orange-portal-on.png")
            }),
            blue_portal_on: new Material(new Textured_Phong(), {
                color: hex_color("#000000"),
                ambient: 1.0, diffusivity: 0.1, specularity: 0.1,
                texture: new Texture("assets/blue-portal-on.png")
            }),
            orange_portal_off: new Material(new Textured_Phong(), {
                color: hex_color("#000000"),
                ambient: 1.0, diffusivity: 0.1, specularity: 0.1,
                texture: new Texture("assets/orange-portal-off.png")
            }),
            blue_portal_off: new Material(new Textured_Phong(), {
                color: hex_color("#000000"),
                ambient: 1.0, diffusivity: 0.1, specularity: 0.1,
                texture: new Texture("assets/blue-portal-off.png")
            }),
        }

        this.w_pressed = false;
        this.a_pressed = false;
        this.s_pressed = false;
        this.d_pressed = false;

        this.asish_mode = false;

        // Portal variables
        this.portal1 = new Portal(vec3(-15, 1, 24.9), vec3(0, 0, -1), 5, 5, this.materials.orange_portal_off, this.materials.orange_portal_on);
        this.portal2 = new Portal(vec3(-24.9, 1, 0), vec3(1, 0, 0), 5, 5, this.materials.blue_portal_off, this.materials.blue_portal_on);
        this.max_portaling_distance = 150.0;
        this.requested_portal1_shoot = false;
        this.requested_portal2_shoot = false;

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

    // Precondition: point_on_plane_of_wall is on the plane described by wall.normal and wall.center
    is_planar_point_on_wall(wall, point_on_plane_of_wall) {
        const p = point_on_plane_of_wall;
        const point_of_contact_vertical = p[1] - wall.center[1];
        const point_of_contact_horizontal = vec3(p[0], 0, p[2]).minus(vec3(wall.center[0], 0, wall.center[2])).norm();
        const on_wall_vertical = Math.abs(point_of_contact_vertical) <= wall.height / 2;
        const on_wall_horizontal = Math.abs(point_of_contact_horizontal) <= wall.width / 2;
        return on_wall_vertical && on_wall_horizontal;
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
        if (t < player_radius && t > -this.player_speed) {
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
        if (t < player_radius && t > -this.player_speed) {
            const radius_component_not_inside_wall = Math.sqrt(player_radius ** 2 - t ** 2);
            const point_of_contact = this.nearest_point_on_plane_to_point(in_portal.normal, in_portal.center, this.player.position);
            const point_of_contact_vertical = point_of_contact[1] - in_portal.center[1];
            const point_of_contact_horizontal = vec3(point_of_contact[0], 0, point_of_contact[2]).minus(vec3(in_portal.center[0], 0, in_portal.center[2])).norm();
            const wall_contact_vertical = point_of_contact_vertical <= in_portal.height / 2
                || point_of_contact_vertical >= in_portal.height / 2 - player_height;
            const wall_contact_horizontal = Math.abs(point_of_contact_horizontal) <= in_portal.width / 2 + radius_component_not_inside_wall;
            if (wall_contact_vertical && wall_contact_horizontal) {
                // Player has gone into the portal; spawn them out on the other side.
                this.player.orientation_clockwise = Math.atan2(out_portal.normal[0], -out_portal.normal[2]);
                return vec4(out_portal.center[0], 0, out_portal.center[2], 0).plus(out_portal.normal);
            }
            // Otherwise the player is going around the wall.
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
        const [wall, look_at_point, t] = this.determine_player_look_at(walls);
        if (wall === null || t > this.max_portaling_distance) {
            return null;
        }
        // Return null if the edges of the portal would go outside the bounds of wall.
        const width = 5.0;
        const height = 5.0;
        const top = look_at_point.plus(vec4(0, height / 2, 0, 0));
        const bottom = look_at_point.plus(vec4(0, -height / 2, 0, 0));
        const left = look_at_point.plus(wall.normal.cross(vec4(0, width / 2, 0, 0)));
        const right = look_at_point.plus(wall.normal.cross(vec4(0, -width / 2, 0, 0)));
        const portal_fits_on_wall = [top, bottom, left, right].every(p => this.is_planar_point_on_wall(wall, p));
        if (!portal_fits_on_wall) {
            return null;
        }
        // TODO return null if the new portal would overlap with the existing *other* portal.
        return new Portal(look_at_point.plus(wall.normal.times(0.01)), wall.normal, width,  height, material_off, material_on);
    }

    make_control_panel() {
        // Draw the scene's buttons, setup their actions and keyboard shortcuts, and monitor live measurements.
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
        this.key_triggered_button("Shoot first portal", ["o"], () => {
            if (this.has_pointer_lock) {
                this.requested_portal1_shoot = true;
            }
        });
        this.key_triggered_button("Shoot second portal", ["p"], () => {
            if (this.has_pointer_lock) {
                this.requested_portal2_shoot = true;
            }
        });
        this.new_line();
        this.key_triggered_button("Switch Mouse Mode", ["Control", "1"], () => {
            console.log("Switch Mouse Mode");
        });
        this.new_line();
        this.key_triggered_button("Toggle Asish Mode", ["x"], () => {
            this.asish_mode ^= 1;
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
                dark_overlay.requestPointerLock({unadjustedMovement: true});
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

    draw_environment(context, program_state, environment_transform) {
        // Draw floor at origin translated down by y = -0.5 units
        var floor_transform = Mat4.identity();
        var horizontal_angle = Math.PI / 2;

        floor_transform = floor_transform.times(Mat4.scale(100, 8, 100).times(Mat4.translation(0, -0.5, 0)).times(Mat4.rotation(horizontal_angle, 1, 0, 0)));
        this.shapes.square.draw(context, program_state, floor_transform, this.materials.floor_texture);

    }

    display(context, program_state) {
        // display():  Called once per frame of animation.
        // Setup -- This part sets up the scene's overall camera matrix, projection matrix, and lights:
        if (!context.scratchpad.controls) {
            // Define the global projection matrix, which is stored in program_state.
            program_state.projection_transform = Mat4.perspective(
                Math.PI / 4, context.width / context.height, .1, 1000);
        }
        if (!this.has_initialized) {
            this.runtime_initialize();
            this.has_initialized = true;
        }
        // Pause everything if we don't have the pointer lock.
        program_state.animate = this.has_pointer_lock;


        // Small displacement so we can make walls seem double-sided but they're really not
        const eps = 0.01; // 0.01 seems to work and not be visible

        // Add all walls to this variable
        var game_walls = [];

        // Test walls forming the center box
        // Note: to implement asish_mode, I had to make the my_walls vars instead of const due to scoping issues

        var my_wall;
        var my_wall2;
        var my_wall3;
        var my_wall4;
        if (this.asish_mode) {
            // Collision Box Code: Uses Asish Texture for walls, moved box to be visible above floor
            my_wall = new Wall(vec3(0, -2, -4.5), vec3(0, 0, 1), 3, 3, this.materials.asish_texture);
            my_wall2 = new Wall(vec3(0, -2, -7.5), vec3(0, 0, -1), 3, 3, this.materials.asish_texture);
            my_wall3 = new Wall(vec3(-1.5, -2, -6), vec3(-1, 0, 0), 3, 3, this.materials.asish_texture);
            my_wall4 = new Wall(vec3(1.5, -2, -6), vec3(1, 0, 0), 3, 3, this.materials.asish_texture);
        }
        else {
            // Original Collision Box Code: Draws box in solid colors
            my_wall = new Wall(vec3(0, -2, -4.5), vec3(0, 0, 1), 3, 3, this.materials.wall_texture2);
            my_wall2 = new Wall(vec3(0, -2, -7.5), vec3(0, 0, -1), 3, 3, this.materials.wall_texture2);
            my_wall3 = new Wall(vec3(-1.5, -2, -6), vec3(-1, 0, 0), 3, 3, this.materials.wall_texture2);
            my_wall4 = new Wall(vec3(1.5, -2, -6), vec3(1, 0, 0), 3, 3, this.materials.wall_texture2);
        }

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

        // // First room backwalls
        // const rm1_front1_b = new Wall(vec3(-15, 0, -(25 + eps)), vec3(0, 0, -1), 20 + 2 * eps, 10, this.materials.wall_texture2);
        // const rm1_front2_b = new Wall(vec3(15, 0, -(25 + eps)), vec3(0, 0, -1), 20 + 2 * eps, 10, this.materials.wall_texture2);
        // const rm1_back_b = new Wall(vec3(0, 0, 25 + eps), vec3(0, 0, 1), 50 + 2 * eps, 10, this.materials.wall_texture2);
        // const rm1_left_b = new Wall(vec3(25 + eps, 0, 0), vec3(1, 0, 0), 50 + 2 * eps, 10, this.materials.wall_texture2);
        // const rm1_right_b = new Wall(vec3(-(25 + eps), 0, 0), vec3(-1, 0, 0), 50 + 2 * eps, 10, this.materials.wall_texture2);
        // const rm1_b = [rm1_front1_b, rm1_front2_b, rm1_back_b, rm1_left_b, rm1_right_b];
        // game_walls = game_walls.concat(rm1_b);

        // Second room
        const rm2_front1 = new Wall(vec3(-30, 0, -50), vec3(0, 0, -1), 50, 10, this.materials.test.override({color: hex_color("#ff4040")}));
        const rm2_front2 = new Wall(vec3(15, 0, -50), vec3(0, 0, -1), 20, 10, this.materials.test.override({color: hex_color("#ff4040")}));
        //const rm2_back = new Wall(vec3(0, 0, 25), vec3(0, 0, -1), 50, 10, this.materials.wall);
        const rm2_left = new Wall(vec3(-25, 0, -75), vec3(1, 0, 0), 50, 10, this.materials.test.override({color: hex_color("#ff4040")}));
        const rm2_right = new Wall(vec3(25, 0, -75), vec3(-1, 0, 0), 50, 10, this.materials.test.override({color: hex_color("#ff4040")}));
        const rm2 = [rm2_front1, rm2_front2, rm2_left, rm2_right];
        game_walls = game_walls.concat(rm2);

        // // Second room backwalls
        // const rm2_front1_b = new Wall(vec3(-30, 0, -50 + eps), vec3(0, 0, 1), 50 + 2 * eps, 10, this.materials.test.override({color: hex_color("#0066ff")}));
        // const rm2_front2_b = new Wall(vec3(15, 0, -50 + eps), vec3(0, 0, 1), 20 + 2 * eps, 10, this.materials.test.override({color: hex_color("#0066ff")}));
        // //const rm2_back = new Wall(vec3(0, 0, 25), vec3(0, 0, -1), 50, 10, this.materials.wall);
        // const rm2_left_b = new Wall(vec3(-(25 + eps), 0, -75), vec3(-1, 0, 0), 50 + 2 * eps, 10, this.materials.test.override({color: hex_color("#0066ff")}));
        // const rm2_right_b = new Wall(vec3(25 + eps, 0, -75), vec3(1, 0, 0), 50 + 2 * eps, 10, this.materials.test.override({color: hex_color("#0066ff")}));
        // const rm2_b = [rm2_front1_b, rm2_front2_b, rm2_left_b, rm2_right_b];
        // game_walls = game_walls.concat(rm2_b);

        if (program_state.animate) {
            // PUT ALL UPDATE LOGIC HERE
            this.move_player_from_wasd(program_state.animation_delta_time);
            // Do physics
            for (const wall of game_walls) {
                const resolution_force = this.solve_player_collision(wall, 1.0, 2.0);
                this.player.position = this.player.position.plus(resolution_force);
            }

            this.player.position = this.solve_player_collision_portal(this.portal1, this.portal2, 1.0, 2.0);
            this.player.position = this.solve_player_collision_portal(this.portal2, this.portal1, 1.0, 2.0);

            if (this.requested_portal1_shoot) {
                this.requested_portal1_shoot = false;
                const new_portal = this.try_create_portal(game_walls, this.materials.orange_portal_off, this.materials.orange_portal_on);
                if (new_portal !== null) {
                    this.portal1 = new_portal;
                }
            }
            if (this.requested_portal2_shoot) {
                this.requested_portal2_shoot = false;
                const new_portal = this.try_create_portal(game_walls, this.materials.blue_portal_off, this.materials.blue_portal_on);
                if (new_portal !== null) {
                    this.portal2 = new_portal;
                }
            }
        }

        // Create light for the 3-d plane
        const light_position = vec4(0, 0, 0, 1);
        var curr_color = color(1, 1, 1, 1);
        program_state.lights = [new Light(light_position, curr_color, 1)];

        // Draw floor
        this.draw_environment(context, program_state);

        // Draw walls
        for (const wall of game_walls) {
            wall.draw(context, program_state, this.shapes.square);
        }

        // Draw portals
        if (this.portal1) {
            this.portal1.draw(context, program_state, this.shapes.square, this.portal2);
        }
        if (this.portal2) {
            this.portal2.draw(context, program_state, this.shapes.square, this.portal1);
        }

        // Create Body (A sphere below the player/camera transform)
        // Note: The sphere currently partially obstructs the camera view to ensure that the sphere is there
        var body_transform = program_state.camera_transform.times(Mat4.translation(0, -1.05, 0));
        this.shapes.sphere3.draw(context, program_state, body_transform, this.materials.test);

        // When the player is looking at a plane, draw a sphere there.
        const [_wall, look_at_point, _look_at_t] = this.determine_player_look_at(game_walls);
        if (look_at_point !== null) {
            const sphere_transform = Mat4.translation(...xyz(look_at_point)).times(Mat4.scale(0.2, 0.2, 0.2));
            this.shapes.sphere3.draw(context, program_state, sphere_transform, this.materials.test.override({color: hex_color("#ff4040")}));
        }

        // Set the camera for this frame
        const player_look_transform = Mat4.rotation(this.player.orientation_clockwise, 0, -1, 0).times(Mat4.rotation(this.player.orientation_up, 1, 0, 0));
        const player_transform = Mat4.translation(...this.player.position).times(player_look_transform);
        program_state.set_camera(Mat4.inverse(player_transform));
    }
}
