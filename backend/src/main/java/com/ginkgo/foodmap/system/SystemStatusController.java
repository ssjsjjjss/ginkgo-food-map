package com.ginkgo.foodmap.system;

import com.ginkgo.foodmap.common.api.ApiResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/public/status")
public class SystemStatusController {

    @GetMapping
    ApiResponse<Map<String, String>> status() {
        return ApiResponse.ok(Map.of(
                "application", "ginkgo-food-map-v2",
                "architecture", "modular-monolith"
        ));
    }
}
